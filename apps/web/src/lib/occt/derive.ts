/**
 * Geometry helpers — derive bounding box, signed volume, projected area,
 * and (via Three.js BVH raycasting) the per-surface wall thickness from
 * a flat positions/indices triangle soup.
 *
 * Lengths are in millimetres throughout. Volumes are mm³, areas are mm².
 * The bbox / volume / projected-area helpers are pure JS with no Three
 * imports so they're cheap to call. The wall-thickness helper uses
 * `three-mesh-bvh` to raycast inward from every triangle.
 */

import * as THREE from 'three';
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// One-time install of three-mesh-bvh's accelerated raycast on the
// Three.js classes. Idempotent — re-running just re-points the methods.
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree })
  .computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree })
  .disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast })
  .raycast = acceleratedRaycast;

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface DerivedPartGeometry {
  /** Axis-aligned bounding box. */
  bbox: AABB;
  /** Bounding-box dimensions (max - min) in mm. */
  dimsMm: { w: number; d: number; h: number };
  /** Signed volume of the closed mesh in mm³. Negative values get clamped. */
  volumeMm3: number;
  /** Top-down (XZ-plane) projected area in mm². */
  projectedAreaMm2: number;
  /** Triangle count — handy for "is this STEP file too big?" warnings. */
  triangleCount: number;
  /**
   * Wall thickness derived per-surface-point via BVH raycasting, then
   * aggregated. Median is the "representative" value (used for the
   * Part Wall Thickness input); min flags short-shot risk; max flags
   * cooling-time outliers.
   */
  wallThicknessMm: {
    median: number;
    min: number;
    max: number;
    /** Number of surface samples that produced a finite measurement. */
    sampleCount: number;
  };
}

export function aabbFromPositions(positions: Float32Array): AABB {
  if (positions.length < 3) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = positions[0]!, minY = positions[1]!, minZ = positions[2]!;
  let maxX = minX, maxY = minY, maxZ = minZ;
  for (let i = 3; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < minX) minX = x; else if (x > maxX) maxX = x;
    if (y < minY) minY = y; else if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; else if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Closed-mesh signed volume via tetrahedral decomposition (Cha Zhang &
 * Tsuhan Chen, "Efficient feature extraction for 2D/3D objects in mesh
 * representation", 2001). For each triangle (a, b, c), the contribution
 * is (a · (b × c)) / 6. Sum is the closed volume; the sign depends on
 * triangle winding, so we take |sum|.
 */
export function signedVolumeMm3(positions: Float32Array, indices: Uint32Array): number {
  let v6 = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;
    const ax = positions[ia]!,     ay = positions[ia + 1]!, az = positions[ia + 2]!;
    const bx = positions[ib]!,     by = positions[ib + 1]!, bz = positions[ib + 2]!;
    const cx = positions[ic]!,     cy = positions[ic + 1]!, cz = positions[ic + 2]!;
    // a · (b × c)
    v6 += ax * (by * cz - bz * cy)
        + ay * (bz * cx - bx * cz)
        + az * (bx * cy - by * cx);
  }
  return Math.abs(v6) / 6;
}

/**
 * Top-down silhouette area on the XZ plane (Y is the mould's vertical /
 * clamp axis in our scene). Computed via 2D triangle areas — over-counts
 * convex parts (multiple triangles can project onto the same XZ region)
 * but is a faithful upper bound on projected area, which is what the
 * clamp-force calc wants. For an exact silhouette we'd need a 2D union
 * over all triangles, which is overkill for sanity-grade clamp sizing.
 */
export function projectedAreaXZMm2(positions: Float32Array, indices: Uint32Array): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;
    const ax = positions[ia]!,     az = positions[ia + 2]!;
    const bx = positions[ib]!,     bz = positions[ib + 2]!;
    const cx = positions[ic]!,     cz = positions[ic + 2]!;
    // Project onto Y=0 plane and use shoelace. Take absolute value so
    // back-faces still contribute positively.
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  // Each surface point is hit by both a top-facing and bottom-facing
  // triangle on a closed mesh, so divide by 2 to approximate silhouette.
  return area / 2;
}

/**
 * Exact wall thickness via inward ray-casting from every triangle.
 *
 * For each triangle in the mesh:
 *   1. Take its centroid and inward-pointing face normal.
 *   2. Step the origin a tiny bit inward to avoid self-hit on the source
 *      triangle.
 *   3. Raycast along the inward normal; first hit on the *opposite* wall
 *      gives the local wall thickness at that point.
 *
 * The mesh-BVH acceleration structure makes each raycast O(log N), so
 * even meshes with tens of thousands of triangles finish in milliseconds.
 *
 * Aggregation: we report the median (single representative value used
 * for the Part Wall Thickness input — robust to outliers from edges and
 * fillets), plus the min and max for flagging short-shot or cooling
 * concerns. Triangles whose ray escapes the part (open boundary, or a
 * surface facing outward at a hole) are skipped.
 */
export function wallThicknessFromMesh(
  positions: Float32Array,
  indices: Uint32Array,
): { median: number; min: number; max: number; sampleCount: number } {
  if (indices.length === 0) {
    return { median: 0, min: 0, max: 0, sampleCount: 0 };
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const bvh = new MeshBVH(geo);

  // Tiny offset to keep the raycast origin off the source triangle.
  // 1 µm — small relative to any real injection-mould wall, large enough
  // to defeat numerical self-hits from the triangle we're shooting from.
  const EPS = 1e-3;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const ray = new THREE.Ray();
  const target = new THREE.Vector3();

  const samples: number[] = [];
  const aabb = aabbFromPositions(positions);
  const diag = Math.hypot(
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
  );
  // Caps thickness at the bounding-box diagonal — anything longer means
  // the ray escaped through a hole or hit a far-away wall and isn't
  // representative of "this triangle's local wall".
  const maxRayLen = diag;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;
    a.set(positions[ia]!, positions[ia + 1]!, positions[ia + 2]!);
    b.set(positions[ib]!, positions[ib + 1]!, positions[ib + 2]!);
    c.set(positions[ic]!, positions[ic + 1]!, positions[ic + 2]!);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();
    if (!Number.isFinite(normal.x)) continue; // degenerate triangle
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);

    // Inward normal — three-mesh-bvh + computeVertexNormals produces
    // OUTWARD-facing normals on a closed mesh (CCW winding). Flip for
    // the inward shot.
    ray.origin.copy(centroid).addScaledVector(normal, -EPS);
    ray.direction.copy(normal).multiplyScalar(-1);

    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (!hit) continue;
    if (hit.distance > maxRayLen) continue;
    samples.push(hit.distance);
    void target;
  }

  geo.dispose();
  bvh.geometry.dispose?.();

  if (samples.length === 0) {
    return { median: 0, min: 0, max: 0, sampleCount: 0 };
  }
  samples.sort((x, y) => x - y);
  const median = samples[Math.floor(samples.length / 2)]!;
  return {
    median,
    min: samples[0]!,
    max: samples[samples.length - 1]!,
    sampleCount: samples.length,
  };
}

export function deriveGeometry(positions: Float32Array, indices: Uint32Array): DerivedPartGeometry {
  const bbox = aabbFromPositions(positions);
  const w = bbox.max[0] - bbox.min[0];
  const h = bbox.max[1] - bbox.min[1];
  const d = bbox.max[2] - bbox.min[2];
  return {
    bbox,
    dimsMm: { w, d, h },
    volumeMm3: signedVolumeMm3(positions, indices),
    projectedAreaMm2: projectedAreaXZMm2(positions, indices),
    triangleCount: indices.length / 3,
    wallThicknessMm: wallThicknessFromMesh(positions, indices),
  };
}
