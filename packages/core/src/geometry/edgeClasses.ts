/**
 * Edge-class grouping for the Runner Dimensions panel.
 *
 * Background — when the balancer applies per-edge Ø overrides (Fishbone Grad,
 * T-Runner, Inline), the panel still shows one Ø input per *level*, hiding
 * the variation. This helper splits each level into structural classes so
 * the UI can render multiple rows under the same level name.
 *
 * Classification rule:
 *
 *   Two edges in the same level belong to the same CLASS iff they share
 *   ALL THREE:
 *     • chain position from the sprue — number of edges between sprue and
 *       this edge's child node — so a "Section 1" sub-row groups every
 *       first-from-sprue chain edge, "Section 2" groups every second-from-
 *       sprue chain edge, and so on.
 *     • segment length, rounded to a 5 mm bucket — so star-topology layouts
 *       (where chain position is identical for every sibling) still split
 *       on length differences after the balancer assigns per-edge Ø/L.
 *     • upstream path length — total mm from sprue to this edge's parent,
 *       rounded to a 5 mm bucket. Required for Inline-style layouts where
 *       every drop sits at the same chainPos but its parent main runner
 *       is a different distance from the sprue (e.g. 5-cav Inline drops:
 *       middle = 0 mm upstream, inner pair = 80 mm, outer pair = 160 mm).
 *
 * Section ordering within a level: sort by chain-position ascending, then
 * by upstream-length ascending, then by segment-length ascending. So
 * Section 1 is closest to sprue with the shortest path, Section 2 next, etc.
 */

import type { RunnerEdge, RunnerTree } from './tree';

export interface EdgeClass {
  /**
   * Stable key — `${levelKey}:${chainPos}:${firstEdgeId}`. We deliberately
   * key on the first edge id (stable across calc rebuilds because edge ids
   * are assigned in deterministic layout-generation order) instead of a
   * bucketed length: a length-bucket key would change every time the user
   * typed a digit into the L cell, causing React to unmount/remount the
   * input and steal focus mid-edit.
   */
  readonly key: string;
  /** Per-class label, e.g. "Section 1". */
  readonly label: string;
  /** Per-edge length for this class (mm, rounded to 5 mm). */
  readonly segmentLenMm: number;
  /** Number of edges between the sprue and this class's edges (≥ 1). */
  readonly chainPosition: number;
  /** Number of edges in this class (always ≥ 1). */
  readonly count: number;
  /** Edge.ids belonging to this class. */
  readonly edgeIds: readonly number[];
  /**
   * When true, all sections in the same level must share one L value —
   * editing L on any section in this level updates every edge at that level.
   * Set on depth-≥-1 levels (Sub Runner, Branch Runner …) where every
   * edge is a junction-to-cavity branch and physical length is fixed by
   * geometry. Depth 0 (Main Runner spine) keeps lengths independent so
   * each chain segment can be tuned separately.
   */
  readonly shareLength: boolean;
}

const LEN_BUCKET_MM = 5;

/**
 * Returns a map keyed by levelKey. Levels with only one class still appear,
 * with a single-entry array — the panel can short-circuit on length === 1
 * and render the existing single-row UI.
 */
export function computeEdgeClasses(tree: RunnerTree): Map<string, EdgeClass[]> {
  const out = new Map<string, EdgeClass[]>();
  const sprue = tree.nodes.find((n) => n.kind === 'sprue');
  if (!sprue) return out;

  // Walk parent edges to compute chain-position (number of edges from
  // sprue to each edge's child node). Memoised so big trees stay O(N).
  const parentEdgeOf = new Map<number, RunnerEdge>();
  for (const e of tree.edges) parentEdgeOf.set(e.childNodeId, e);
  const chainPosOf = new Map<number, number>();
  chainPosOf.set(sprue.id, 0);
  const chainPos = (nodeId: number): number => {
    const cached = chainPosOf.get(nodeId);
    if (cached !== undefined) return cached;
    const edge = parentEdgeOf.get(nodeId);
    if (!edge) {
      chainPosOf.set(nodeId, 0);
      return 0;
    }
    const value = chainPos(edge.parentNodeId) + 1;
    chainPosOf.set(nodeId, value);
    return value;
  };

  // Walk the path from sprue to a node, summing edge lengths. Memoised.
  // Used as a tertiary class disambiguator for star-style layouts where
  // chainPos and own-length match across all siblings.
  const pathLenOf = new Map<number, number>();
  pathLenOf.set(sprue.id, 0);
  const pathLen = (nodeId: number): number => {
    const cached = pathLenOf.get(nodeId);
    if (cached !== undefined) return cached;
    const edge = parentEdgeOf.get(nodeId);
    if (!edge) {
      pathLenOf.set(nodeId, 0);
      return 0;
    }
    const value = pathLen(edge.parentNodeId) + edge.lenMm;
    pathLenOf.set(nodeId, value);
    return value;
  };

  // Group by levelKey → composite key `${pos}|${lenBucket}|${upstreamBucket}`.
  const grouped = new Map<
    string,
    Map<string, { pos: number; len: number; upstream: number; edges: RunnerEdge[] }>
  >();
  for (const e of tree.edges) {
    const pos = chainPos(e.childNodeId);
    const lenBucket = Math.round(e.lenMm / LEN_BUCKET_MM) * LEN_BUCKET_MM;
    const upstreamLen = pathLen(e.parentNodeId);
    const upstreamBucket = Math.round(upstreamLen / LEN_BUCKET_MM) * LEN_BUCKET_MM;
    const compositeKey = `${pos}|${lenBucket}|${upstreamBucket}`;
    if (!grouped.has(e.levelKey)) grouped.set(e.levelKey, new Map());
    const byKey = grouped.get(e.levelKey)!;
    if (!byKey.has(compositeKey)) {
      byKey.set(compositeKey, { pos, len: lenBucket, upstream: upstreamBucket, edges: [] });
    }
    byKey.get(compositeKey)!.edges.push(e);
  }

  for (const [levelKey, byKey] of grouped) {
    const classes: EdgeClass[] = [];
    // Sort by chain-position ascending, then upstream-length ascending,
    // then own-length ascending — Section 1 is the section closest to the
    // sprue along the shortest path.
    const groups = [...byKey.values()].sort(
      (a, b) => (a.pos - b.pos) || (a.upstream - b.upstream) || (a.len - b.len),
    );
    // shareLength: depth-0 (Main spine) sections can have independent L per
    // chain segment; every other depth is a junction-to-cavity branch where
    // physical L is fixed by geometry, so all sections must share L.
    const depthMatch = /^L(\d+)$/.exec(levelKey);
    const depth = depthMatch ? parseInt(depthMatch[1]!, 10) : 0;
    const shareLength = depth >= 1;
    groups.forEach((g, i) => {
      const firstEdgeId = g.edges.reduce((min, e) => (e.id < min ? e.id : min), g.edges[0]!.id);
      classes.push({
        key: `${levelKey}:${g.pos}:${firstEdgeId}`,
        // Engineers think structurally ("section 1 / 2"); the exact
        // segment length is exposed via `segmentLenMm` for tooltips.
        label: `Section ${i + 1}`,
        segmentLenMm: g.len,
        chainPosition: g.pos,
        count: g.edges.length,
        edgeIds: g.edges.map((e) => e.id),
        shareLength,
      });
    });
    out.set(levelKey, classes);
  }

  return out;
}
