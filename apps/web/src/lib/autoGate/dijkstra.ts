/**
 * Single-source shortest-path on a vertex adjacency graph (Dijkstra's
 * algorithm). Used by the auto-gate analyser to measure flow length L
 * from a candidate gate vertex to every other vertex on the mesh —
 * the geodesic-along-mesh-edges proxy for surface distance.
 *
 * Implementation uses a binary min-heap on (distance, vertexId) pairs.
 * Avoids the standard JS PriorityQueue object-per-entry overhead by
 * keeping two parallel arrays (heap-of-distance, heap-of-id) sized to
 * vertexCount × 2 — every vertex can enter the heap up to ~degree
 * times via the lazy "skip stale entries" trick. Worst case O((V+E) log V).
 *
 * Returns:
 *   distances    — Float32Array[V], +Infinity for unreachable vertices
 *   reached      — count of vertices actually visited (≤ V)
 *
 * The caller derives summary stats (max, stddev) over the FINITE entries.
 */
import type { Adjacency } from './adjacency';

export interface DijkstraResult {
  distances: Float32Array;
  reached: number;
}

export function dijkstraFrom(adj: Adjacency, source: number): DijkstraResult {
  const V = adj.vertexCount;
  const distances = new Float32Array(V);
  // Float32Array can't hold Infinity exactly but it can hold the largest
  // finite f32, which is ~3.4e38 — plenty bigger than any plausible mesh
  // path length in mm. Use Number.POSITIVE_INFINITY literal; f32 stores it.
  for (let i = 0; i < V; i++) distances[i] = Number.POSITIVE_INFINITY;
  distances[source] = 0;

  // Binary min-heap stored in parallel arrays. Capacity grows on demand.
  let heapDist: number[] = [0];
  let heapNode: number[] = [source];

  const swap = (i: number, j: number): void => {
    const td = heapDist[i]!; heapDist[i] = heapDist[j]!; heapDist[j] = td;
    const tn = heapNode[i]!; heapNode[i] = heapNode[j]!; heapNode[j] = tn;
  };
  const siftUp = (i: number): void => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapDist[p]! <= heapDist[i]!) break;
      swap(p, i);
      i = p;
    }
  };
  const siftDown = (i: number): void => {
    const n = heapDist.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < n && heapDist[l]! < heapDist[best]!) best = l;
      if (r < n && heapDist[r]! < heapDist[best]!) best = r;
      if (best === i) break;
      swap(best, i);
      i = best;
    }
  };

  let reached = 0;

  while (heapDist.length > 0) {
    const d = heapDist[0]!;
    const u = heapNode[0]!;
    // Pop root
    const last = heapDist.length - 1;
    if (last === 0) {
      heapDist = []; heapNode = [];
    } else {
      heapDist[0] = heapDist[last]!;
      heapNode[0] = heapNode[last]!;
      heapDist.length = last;
      heapNode.length = last;
      siftDown(0);
    }

    // Stale entry — better distance already finalised, skip.
    if (d > distances[u]!) continue;
    reached++;

    const start = adj.adjacencyStart[u]!;
    const end = adj.adjacencyStart[u + 1]!;
    for (let k = start; k < end; k++) {
      const v = adj.neighbours[k]!;
      const alt = d + adj.weights[k]!;
      if (alt < distances[v]!) {
        distances[v] = alt;
        heapDist.push(alt);
        heapNode.push(v);
        siftUp(heapDist.length - 1);
      }
    }
  }

  return { distances, reached };
}

/**
 * Summary stats over the FINITE entries of a distances array. Returns
 * `null` if no finite entries (degenerate). Callers feed these into the
 * scoring formula.
 */
export interface DistanceStats {
  max: number;
  mean: number;
  stddev: number;
  reachedCount: number;
}

export function distanceStats(distances: Float32Array): DistanceStats | null {
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i]!;
    if (!Number.isFinite(d)) continue;
    if (d > max) max = d;
    sum += d;
    count++;
  }
  if (count === 0) return null;
  const mean = sum / count;
  let varSum = 0;
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i]!;
    if (!Number.isFinite(d)) continue;
    const diff = d - mean;
    varSum += diff * diff;
  }
  return {
    max,
    mean,
    stddev: Math.sqrt(varSum / count),
    reachedCount: count,
  };
}
