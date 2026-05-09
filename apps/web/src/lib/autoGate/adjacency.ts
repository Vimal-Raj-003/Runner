/**
 * Vertex-adjacency graph for an indexed triangle mesh.
 *
 * Output is a flat CSR-style structure (start indices + neighbour list +
 * edge weights) rather than a Map<vertex, neighbours[]>: cache-friendly
 * for Dijkstra's hot loop and trivially serialisable across the worker
 * boundary if we ever need to.
 *
 * Edge weight = euclidean distance between the two vertex positions.
 * Each unique edge is recorded once even if shared by two triangles
 * (manifold meshes typical of injection-mould parts).
 */
export interface Adjacency {
  /** Number of vertices in the mesh. */
  vertexCount: number;
  /**
   * For vertex i, neighbours live in
   *   [adjacencyStart[i], adjacencyStart[i + 1])
   * inside the `neighbours` and `weights` arrays.
   * Length = vertexCount + 1 (last entry = total edge endpoints).
   */
  adjacencyStart: Uint32Array;
  /** Neighbour vertex ids, packed per vertex. */
  neighbours: Uint32Array;
  /** Edge weights, parallel to `neighbours`. */
  weights: Float32Array;
}

/**
 * Build the adjacency graph. One pass over triangles to collect unique
 * edges into per-vertex lists, then flatten into the CSR arrays.
 *
 * Edge uniqueness uses the unordered key `min(a,b)*V + max(a,b)` stored
 * in a Set per source vertex to dedupe within a triangle's contribution.
 * For a 5 k-vertex / 10 k-triangle mesh this runs in tens of ms.
 */
export function buildAdjacency(
  positions: Float32Array,
  indices: Uint32Array,
): Adjacency {
  const vertexCount = positions.length / 3;

  // First pass: temporary per-vertex Sets of neighbour ids (for dedup).
  // Set<number> is cheaper than Map<number, weight> here since the weight
  // only depends on the two vertex positions, not the triangle.
  const neighbourSets: Set<number>[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) neighbourSets[i] = new Set();

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    if (a === b || b === c || a === c) continue; // degenerate triangle
    neighbourSets[a]!.add(b); neighbourSets[a]!.add(c);
    neighbourSets[b]!.add(a); neighbourSets[b]!.add(c);
    neighbourSets[c]!.add(a); neighbourSets[c]!.add(b);
  }

  // Second pass: flatten. Sum sizes to size the flat arrays.
  let total = 0;
  for (let i = 0; i < vertexCount; i++) total += neighbourSets[i]!.size;

  const adjacencyStart = new Uint32Array(vertexCount + 1);
  const neighbours = new Uint32Array(total);
  const weights = new Float32Array(total);

  let cursor = 0;
  for (let i = 0; i < vertexCount; i++) {
    adjacencyStart[i] = cursor;
    const ax = positions[i * 3]!;
    const ay = positions[i * 3 + 1]!;
    const az = positions[i * 3 + 2]!;
    for (const j of neighbourSets[i]!) {
      const bx = positions[j * 3]!;
      const by = positions[j * 3 + 1]!;
      const bz = positions[j * 3 + 2]!;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      neighbours[cursor] = j;
      weights[cursor] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cursor++;
    }
  }
  adjacencyStart[vertexCount] = cursor;

  return { vertexCount, adjacencyStart, neighbours, weights };
}
