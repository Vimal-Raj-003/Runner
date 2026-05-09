/**
 * Candidate gate-vertex selection. Greedy Poisson-disk-style sampling
 * over the vertex set: produces a set of vertex ids spread roughly
 * uniformly across the surface, capped at a target count.
 *
 * Strategy:
 *   1. Compute a target spacing = bbox_diag × DEFAULT_SPACING_FRAC.
 *   2. Iterate vertices in a deterministic shuffled order; accept a
 *      vertex if it's farther than `spacing` from every already-accepted
 *      candidate.
 *   3. Filter accepted candidates against `prohibitedRegions` AABBs.
 *
 * Deterministic shuffling (seeded mulberry32) keeps runs reproducible
 * and lets unit tests pin a specific output.
 *
 * For ~5 k vertices and ~100 candidates this runs in a few ms — the
 * O(NK) accept check (N vertices × K accepted candidates) is the
 * dominant cost; well under the Dijkstra step that follows.
 */

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface CandidateOptions {
  /** Fraction of bbox diagonal used as candidate-to-candidate spacing. */
  spacingFrac?: number;
  /** Hard cap on the candidate count (safety net for tiny meshes). */
  maxCandidates?: number;
  /** AABBs in part-local mm. Vertices inside any of these are excluded. */
  prohibitedRegions?: AABB[];
  /** Deterministic seed for the vertex shuffle. */
  seed?: number;
  /**
   * If provided, restricts candidates to vertices that sit ON one of the
   * AABB's six faces — outward normal aligned with a cardinal axis AND
   * position within tolerance of that face plane. Excludes interior
   * features (ribs, bosses, recesses) where the gate-picker's outward-
   * normal heuristic would mis-orient the gate tip and bury its body
   * inside the part. Falls back to "all vertices" when no vertex
   * qualifies (purely curved parts where no normal is cardinal-aligned).
   */
  vertexNormals?: Float32Array;
}

const DEFAULT_SPACING_FRAC = 0.05;
const DEFAULT_MAX_CANDIDATES = 200;

/** mulberry32 — small, deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle on an integer array using the given PRNG. */
function shuffle(arr: Uint32Array, rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t;
  }
}

function pointInAABB(
  x: number, y: number, z: number,
  region: AABB,
): boolean {
  return x >= region.min[0] && x <= region.max[0]
      && y >= region.min[1] && y <= region.max[1]
      && z >= region.min[2] && z <= region.max[2];
}

/**
 * True iff the vertex sits on one of the six AABB faces — required
 * normal alignment AND position within `tol` of the face plane. Used
 * as a pre-filter so the gate-picker's outward-normal logic (which
 * picks the closest AABB face as outward direction) renders the gate
 * tip correctly.
 */
function vertexOnAABBFace(
  px: number, py: number, pz: number,
  nx: number, ny: number, nz: number,
  bbox: AABB,
  tol: number,
): boolean {
  const NORMAL_THRESHOLD = 0.85; // cos(~32°) — accept up to chamfered edges
  return (
    (ny >  NORMAL_THRESHOLD && py > bbox.max[1] - tol) ||
    (ny < -NORMAL_THRESHOLD && py < bbox.min[1] + tol) ||
    (nx >  NORMAL_THRESHOLD && px > bbox.max[0] - tol) ||
    (nx < -NORMAL_THRESHOLD && px < bbox.min[0] + tol) ||
    (nz >  NORMAL_THRESHOLD && pz > bbox.max[2] - tol) ||
    (nz < -NORMAL_THRESHOLD && pz < bbox.min[2] + tol)
  );
}

/**
 * Select candidate vertex ids. Returns a Uint32Array of vertex indices
 * — index into `positions` (multiply by 3 for the position offset).
 */
export function selectCandidates(
  positions: Float32Array,
  bbox: AABB,
  opts: CandidateOptions = {},
): Uint32Array {
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) return new Uint32Array(0);

  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const spacing = diag * (opts.spacingFrac ?? DEFAULT_SPACING_FRAC);
  const spacingSq = spacing * spacing;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const prohibited = opts.prohibitedRegions ?? [];

  // Pre-filter: vertices on AABB faces, using normals if available. Tol
  // is 5 % of the smallest bbox dimension — tight enough to exclude
  // interior features but loose enough to admit chamfered edges. Falls
  // back to "all vertices" when nothing qualifies (rare; e.g. a part
  // whose only flat surface is curved).
  const normals = opts.vertexNormals;
  let faceMask: Uint8Array | null = null;
  if (normals && normals.length === positions.length) {
    const tol = Math.min(dx, dy, dz) * 0.05;
    faceMask = new Uint8Array(vertexCount);
    let onFaceCount = 0;
    for (let v = 0; v < vertexCount; v++) {
      const px = positions[v * 3]!;
      const py = positions[v * 3 + 1]!;
      const pz = positions[v * 3 + 2]!;
      const nx = normals[v * 3]!;
      const ny = normals[v * 3 + 1]!;
      const nz = normals[v * 3 + 2]!;
      if (vertexOnAABBFace(px, py, pz, nx, ny, nz, bbox, tol)) {
        faceMask[v] = 1;
        onFaceCount++;
      }
    }
    // If essentially nothing qualifies, drop the filter — better to
    // pick a sub-optimal candidate than to return zero candidates.
    if (onFaceCount < 8) faceMask = null;
  }

  // Build shuffled vertex order.
  const order = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) order[i] = i;
  shuffle(order, mulberry32(opts.seed ?? 1));

  // Accept-or-reject loop. Keep accepted positions in a flat array
  // for cache-friendly distance checks.
  const acceptedIds: number[] = [];
  const acceptedX: number[] = [];
  const acceptedY: number[] = [];
  const acceptedZ: number[] = [];

  for (let i = 0; i < order.length && acceptedIds.length < maxCandidates; i++) {
    const v = order[i]!;
    if (faceMask && !faceMask[v]) continue; // not on an AABB face
    const px = positions[v * 3]!;
    const py = positions[v * 3 + 1]!;
    const pz = positions[v * 3 + 2]!;

    // Prohibited-region filter. O(numRegions); typically empty.
    let inProhibited = false;
    for (const r of prohibited) {
      if (pointInAABB(px, py, pz, r)) { inProhibited = true; break; }
    }
    if (inProhibited) continue;

    // Spacing check: must be farther than `spacing` from every accepted.
    let tooClose = false;
    for (let k = 0; k < acceptedIds.length; k++) {
      const ddx = acceptedX[k]! - px;
      const ddy = acceptedY[k]! - py;
      const ddz = acceptedZ[k]! - pz;
      if (ddx * ddx + ddy * ddy + ddz * ddz < spacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    acceptedIds.push(v);
    acceptedX.push(px);
    acceptedY.push(py);
    acceptedZ.push(pz);
  }

  return new Uint32Array(acceptedIds);
}
