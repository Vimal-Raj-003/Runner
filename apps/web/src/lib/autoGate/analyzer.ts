/**
 * Top-level auto-gate analysis. Pure function — takes mesh + material
 * params, returns the best gate point. No DOM, no worker plumbing, no
 * THREE Scene — designed to be unit-testable and reusable from either
 * the worker or the main thread.
 *
 * Pipeline (matches the design spec):
 *   1. Build vertex adjacency graph
 *   2. Compute per-vertex outward normals
 *   3. Build BVH for raycasting
 *   4. Sample candidate vertices (Poisson-disk)
 *   5. Per candidate: local wall thickness via inward raycast
 *   6. Per candidate: Dijkstra → flow length stats
 *   7. Score each candidate, pick the top one
 *
 * Returns the best candidate's part-local position + outward normal +
 * the L/t ratio achieved (so the UI can warn when it exceeds the limit).
 */

import * as THREE from 'three';
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

import { buildAdjacency } from './adjacency';
import { selectCandidates, type AABB } from './candidates';
import { thicknessAtCandidates } from './thickness';
import { dijkstraFrom, distanceStats } from './dijkstra';
import { scoreCandidates } from './score';

// One-time install of three-mesh-bvh's accelerated raycast on Three's
// Mesh + BufferGeometry. Idempotent — same install used by lib/occt/derive.ts.
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree })
  .computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree })
  .disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast })
  .raycast = acceleratedRaycast;

export interface AnalyzeOptions {
  /** Material's flow-length ratio limit (L/t). */
  ltLimit: number;
  /** Optional prohibited-region AABBs in part-local mm. */
  prohibitedRegions?: AABB[];
  /** 0..1 progress callback fired periodically during the Dijkstra pass. */
  onProgress?: (pct: number) => void;
}

export interface Suggestion {
  position: [number, number, number];
  normal: [number, number, number];
  score: number;
  maxLtRatio: number;
  candidatesEvaluated: number;
  reachedFraction: number;
}

export type AnalyzeError = { code: 'no_candidates' | 'degenerate_mesh'; message: string };

export type AnalyzeResult = { ok: true; suggestion: Suggestion } | { ok: false; error: AnalyzeError };

const MIN_VERTICES = 100;
const MIN_TRIANGLES = 50;

export function analyzeGate(
  positions: Float32Array,
  indices: Uint32Array,
  bbox: AABB,
  opts: AnalyzeOptions,
): AnalyzeResult {
  const vertexCount = positions.length / 3;
  const triCount = indices.length / 3;
  if (vertexCount < MIN_VERTICES || triCount < MIN_TRIANGLES) {
    return {
      ok: false,
      error: {
        code: 'degenerate_mesh',
        message: `Mesh too small (${vertexCount} vertices, ${triCount} triangles).`,
      },
    };
  }

  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  const bboxDiag = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Build BVH + per-vertex outward normals via a temp BufferGeometry.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const normalsAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
  const vertexNormals = normalsAttr.array as Float32Array;
  const bvh = new MeshBVH(geo);

  try {
    const adj = buildAdjacency(positions, indices);
    const candidates = selectCandidates(positions, bbox, {
      prohibitedRegions: opts.prohibitedRegions,
      vertexNormals,
    });
    if (candidates.length === 0) {
      return {
        ok: false,
        error: {
          code: 'no_candidates',
          message: 'No suitable gate candidates after filtering.',
        },
      };
    }

    const thicknesses = thicknessAtCandidates(positions, vertexNormals, candidates, bvh, bboxDiag);

    const lMax = new Float32Array(candidates.length);
    const lStddev = new Float32Array(candidates.length);
    let totalReached = 0;

    for (let i = 0; i < candidates.length; i++) {
      const { distances, reached } = dijkstraFrom(adj, candidates[i]!);
      const stats = distanceStats(distances);
      lMax[i] = stats?.max ?? Number.POSITIVE_INFINITY;
      lStddev[i] = stats?.stddev ?? Number.POSITIVE_INFINITY;
      totalReached += reached;
      if (opts.onProgress && (i % 5 === 0 || i === candidates.length - 1)) {
        opts.onProgress(((i + 1) / candidates.length) * 100);
      }
    }

    const scored = scoreCandidates({ thicknesses, lMax, lStddev, ltLimit: opts.ltLimit });
    if (scored.length === 0) {
      return {
        ok: false,
        error: { code: 'no_candidates', message: 'Scoring produced no candidates.' },
      };
    }

    // Pick highest-scoring candidate.
    let best = scored[0]!;
    for (let i = 1; i < scored.length; i++) {
      if (scored[i]!.score > best.score) best = scored[i]!;
    }

    const v = candidates[best.index]!;
    const reachedFraction = vertexCount > 0
      ? totalReached / (vertexCount * candidates.length)
      : 0;

    return {
      ok: true,
      suggestion: {
        position: [
          positions[v * 3]!,
          positions[v * 3 + 1]!,
          positions[v * 3 + 2]!,
        ],
        normal: [
          vertexNormals[v * 3]!,
          vertexNormals[v * 3 + 1]!,
          vertexNormals[v * 3 + 2]!,
        ],
        score: best.score,
        maxLtRatio: best.ltRatio,
        candidatesEvaluated: candidates.length,
        reachedFraction,
      },
    };
  } finally {
    geo.dispose();
    (bvh.geometry as { dispose?: () => void }).dispose?.();
  }
}
