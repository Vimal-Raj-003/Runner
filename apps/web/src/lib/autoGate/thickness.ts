/**
 * Per-candidate local wall thickness via inward BVH raycasting.
 *
 * For each candidate vertex we cast a ray from just inside the surface
 * along the inward normal; the first opposing-wall hit gives the local
 * wall thickness. Same physics as `lib/occt/derive.ts` `wallThicknessFromMesh`,
 * but evaluated only at the ~100 candidate vertices instead of every
 * triangle, so it's cheap. We REUSE the BVH the worker already built.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const EPS = 1e-3; // 1 µm offset to defeat self-hit on the source vertex.

/**
 * Compute local thickness at every vertex in `candidates`. Returns
 * Float32Array parallel to `candidates`; entries are 0 when the inward
 * ray escapes (open mesh or vertex on a hole edge).
 *
 * `vertexNormals` is expected to be the outward normal per vertex
 * (length = positions.length, like positions). We flip it for the
 * inward ray.
 *
 * `bvh` is a pre-built MeshBVH over the full mesh; the caller manages
 * its lifetime.
 *
 * `bboxDiag` caps the ray length — anything farther than the bbox
 * diagonal is treated as "escaped" (probably a far-side wall via a
 * concavity, not the local opposing wall).
 */
export function thicknessAtCandidates(
  positions: Float32Array,
  vertexNormals: Float32Array,
  candidates: Uint32Array,
  bvh: MeshBVH,
  bboxDiag: number,
): Float32Array {
  const out = new Float32Array(candidates.length);
  const ray = new THREE.Ray();

  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i]!;
    const px = positions[v * 3]!;
    const py = positions[v * 3 + 1]!;
    const pz = positions[v * 3 + 2]!;
    const nx = vertexNormals[v * 3]!;
    const ny = vertexNormals[v * 3 + 1]!;
    const nz = vertexNormals[v * 3 + 2]!;

    // Inward ray = origin slightly INSIDE the surface (along -normal),
    // direction = -normal.
    ray.origin.set(px - nx * EPS, py - ny * EPS, pz - nz * EPS);
    ray.direction.set(-nx, -ny, -nz);

    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (!hit) { out[i] = 0; continue; }
    if (hit.distance > bboxDiag) { out[i] = 0; continue; }
    out[i] = hit.distance;
  }

  return out;
}
