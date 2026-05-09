/**
 * Dia/length override resolver.
 *
 * The prototype applies overrides by mutating segment endpoints and using
 * Euclidean proximity (< 0.5 scene units) to identify children — fragile
 * when geometry scales. This implementation walks the parent/child tree
 * directly.
 */

import type { RunnerEdge, RunnerNode, RunnerTree } from './tree';

export interface Overrides {
  diaByLevel?: Record<string, number>;  // key = levelKey, mm
  lenByLevel?: Record<string, number>;  // key = levelKey, mm (from-centre for symmetric levels)
  /**
   * Per-edge overrides — keyed by edge.id. Take precedence over diaByLevel.
   * Required for asymmetric layouts (Fishbone Grad, T-Runner, Inline) where
   * different sub-runners feeding different path lengths must carry
   * different diameters to balance fill time.
   */
  diaByEdge?: Record<number, number>;
  lenByEdge?: Record<number, number>;
}

/**
 * Applies diameter overrides in-place. Per-edge values win over per-level.
 * Length overrides are applied separately because they also translate
 * downstream geometry.
 */
export function applyDiameterOverrides(edges: RunnerEdge[], overrides: Overrides): void {
  for (const e of edges) {
    const edgeOverride = overrides.diaByEdge?.[e.id];
    if (edgeOverride && edgeOverride > 0) {
      e.diaMm = edgeOverride;
      continue;
    }
    const levelOverride = overrides.diaByLevel?.[e.levelKey];
    if (levelOverride && levelOverride > 0) {
      e.diaMm = levelOverride;
    }
  }
}

/**
 * Applies length overrides in-place by walking from root outward.
 * For each edge at the overridden level, the child endpoint is moved
 * along the existing direction, and all descendants are translated by
 * the same delta.
 */
export function applyLengthOverrides(tree: RunnerTree, overrides: Overrides): void {
  if (!overrides.lenByLevel && !overrides.lenByEdge) return;

  const childrenOf = buildChildMap(tree);

  // Process outer levels (deeper) AFTER outer levels; actually we process
  // top-down so that when a parent moves, the delta propagates to descendants.
  const maxDepth = Math.max(0, ...tree.edges.map((e) => e.depth));

  for (let depth = 0; depth <= maxDepth; depth++) {
    const edgesAtDepth = tree.edges.filter((e) => e.depth === depth);
    for (const edge of edgesAtDepth) {
      // Per-edge wins over per-level so the panel can drive individual
      // sub-runner lengths after edge-class splitting.
      const edgeTarget = overrides.lenByEdge?.[edge.id];
      const levelTarget = overrides.lenByLevel?.[edge.levelKey];
      const target = (edgeTarget && edgeTarget > 0) ? edgeTarget : levelTarget;
      if (!target || target <= 0) continue;
      applyLength(edge, target, tree.nodes, tree.edges, tree.cavities, childrenOf);
    }
  }
}

function applyLength(
  edge: RunnerEdge,
  targetLenMm: number,
  nodes: RunnerNode[],
  edges: RunnerEdge[],
  cavities: { id: number; x: number; z: number }[],
  childrenOf: Map<number, number[]>,
): void {
  const parent = nodes.find((n) => n.id === edge.parentNodeId);
  const child = nodes.find((n) => n.id === edge.childNodeId);
  if (!parent || !child) return;

  const dx = child.x - parent.x;
  const dz = child.z - parent.z;
  const currentLen = Math.sqrt(dx * dx + dz * dz);
  // Zero-direction edges (gate drops) live in the y-axis only — no 2D
  // motion is possible. Just update the edge's intrinsic length and let
  // the renderer pick up the new value; descendants don't move.
  if (currentLen < 1e-6) {
    edge.lenMm = targetLenMm;
    return;
  }

  const dirX = dx / currentLen;
  const dirZ = dz / currentLen;

  const newChildX = parent.x + dirX * targetLenMm;
  const newChildZ = parent.z + dirZ * targetLenMm;
  const shiftX = newChildX - child.x;
  const shiftZ = newChildZ - child.z;

  // Translate the child node and every descendant node by (shiftX, shiftZ).
  const toMove = descendants(child.id, childrenOf);
  toMove.add(child.id);
  for (const nid of toMove) {
    const n = nodes.find((x) => x.id === nid);
    if (n) {
      (n as { x: number }).x = n.x + shiftX;
      (n as { z: number }).z = n.z + shiftZ;
      if (n.kind === 'cavity' && n.cavityId !== undefined) {
        const cav = cavities.find((c) => c.id === n.cavityId);
        if (cav) {
          cav.x += shiftX;
          cav.z += shiftZ;
        }
      }
    }
  }

  edge.lenMm = targetLenMm;
  // Recompute descendant edge lengths
  for (const e of edges) {
    if (toMove.has(e.childNodeId) || toMove.has(e.parentNodeId)) {
      const p = nodes.find((n) => n.id === e.parentNodeId);
      const c = nodes.find((n) => n.id === e.childNodeId);
      if (p && c) {
        const ex = c.x - p.x;
        const ez = c.z - p.z;
        e.lenMm = Math.sqrt(ex * ex + ez * ez);
      }
    }
  }
}

function buildChildMap(tree: RunnerTree): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const e of tree.edges) {
    const arr = m.get(e.parentNodeId) ?? [];
    arr.push(e.childNodeId);
    m.set(e.parentNodeId, arr);
  }
  return m;
}

function descendants(nodeId: number, childrenOf: Map<number, number[]>): Set<number> {
  const out = new Set<number>();
  const stack = [...(childrenOf.get(nodeId) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...(childrenOf.get(n) ?? []));
  }
  return out;
}
