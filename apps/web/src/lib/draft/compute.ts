/**
 * Per-vertex draft-angle computation.
 *
 * Draft is the angle between the part's surface and the demoulding
 * direction — the steeper, the easier the part releases from the mould.
 * For each vertex normal n and unit demoulding vector d:
 *
 *     α = 90° − arccos(n · d)
 *
 * Equivalently α = arcsin(n · d). Sign convention:
 *
 *   • α > 0  → surface faces ALONG the pull direction → positive draft
 *              (the surface "opens up" as the mould halves separate).
 *   • α = 0  → vertical wall, parallel to pull → marginal.
 *   • α < 0  → surface faces AGAINST the pull → undercut. Requires a
 *              slider / lifter / collapsing core to release the part.
 *
 * Returns a Float32Array of angles in DEGREES, parallel to the vertex
 * positions array (one entry per vertex).
 */

export function draftAnglesFromMesh(
  vertexNormals: Float32Array,
  demouldingDir: readonly [number, number, number],
): Float32Array {
  const vertexCount = vertexNormals.length / 3;
  const out = new Float32Array(vertexCount);

  // Normalise the demoulding vector once; defensive against callers
  // passing a non-unit vector.
  let dx = demouldingDir[0];
  let dy = demouldingDir[1];
  let dz = demouldingDir[2];
  const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dlen < 1e-9) {
    // Degenerate input — return all zeros (treated as marginal).
    return out;
  }
  dx /= dlen; dy /= dlen; dz /= dlen;

  const RAD_TO_DEG = 180 / Math.PI;

  for (let i = 0; i < vertexCount; i++) {
    const nx = vertexNormals[i * 3]!;
    const ny = vertexNormals[i * 3 + 1]!;
    const nz = vertexNormals[i * 3 + 2]!;
    const dot = nx * dx + ny * dy + nz * dz;
    // Clamp because float jitter can push |dot| slightly above 1.
    const clamped = dot > 1 ? 1 : dot < -1 ? -1 : dot;
    out[i] = Math.asin(clamped) * RAD_TO_DEG;
  }
  return out;
}
