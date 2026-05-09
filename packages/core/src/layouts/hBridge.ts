/**
 * H-Bridge layout — binary tree, naturally balanced for N = 2ᵏ.
 *
 * Ports the prototype's `layoutHBridge`: recursively split the cavity set
 * in half, add an edge between the centroids of the two halves, and
 * recurse. Upgrade: emits proper tree with parent/child pointers.
 */

import { addCavityWithDrop, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';
import type { Cavity, RunnerNode, RunnerTree } from '../geometry/tree';

const SPACING = 80; // mm between cavity centres
const BASE_DIA = 8;  // mm — nominal main runner

export const hBridgeLayout: LayoutGenerator = {
  id: 'h_bridge',
  label: 'H-Bridge',
  description: 'Binary tree, naturally balanced for 2ⁿ cavities',
  balance: 'Natural',

  validate(n) {
    const powerOfTwo = n >= 2 && (n & (n - 1)) === 0;
    return powerOfTwo
      ? { ok: true }
      : { ok: false, reason: 'H-Bridge requires cavity count to be a power of two (2, 4, 8, 16, 32…)' };
  },

  generate(n): RunnerTree {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);

    // Build a rows×cols grid
    const lvl = Math.log2(n);
    const cols = Math.pow(2, Math.ceil(lvl / 2));
    const rows = n / cols;

    const cavs: Cavity[] = [];
    // Cavity-id → gate-junction node, so the recursion can connect runner
    // edges to the gate (not the cavity) and the drop edge handles the
    // runner-plane → cavity-top transition.
    const gateById = new Map<number, RunnerNode>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * SPACING;
        const z = (r - (rows - 1) / 2) * SPACING;
        // Drop depth = max depth + 1; for H-Bridge the recursion produces
        // up to depth ⌈log2 n⌉, so we pick a comfortably-deeper drop depth.
        const dropDepth = Math.max(2, lvl);
        const { gate, cavity } = addCavityWithDrop(ctx, x, z, dropDepth);
        cavs.push(cavity);
        gateById.set(cavity.id, gate);
      }
    }

    // Recursive centroid splitter
    function build(points: { x: number; z: number; cavity?: Cavity }[], depth: number, parentNodeId: number): void {
      if (points.length === 0) return;
      if (points.length === 1) {
        const target = points[0]!;
        if (target.cavity) {
          const gate = gateById.get(target.cavity.id);
          const parent = ctx.nodes.find((n) => n.id === parentNodeId);
          if (gate && parent) {
            addEdge(ctx, parent, gate, depth, diaForDepth(BASE_DIA, depth));
          }
        }
        return;
      }
      if (points.length === 2) {
        const mx = (points[0]!.x + points[1]!.x) / 2;
        const mz = (points[0]!.z + points[1]!.z) / 2;
        const parent = ctx.nodes.find((n) => n.id === parentNodeId);
        if (!parent) return;

        const collapsed =
          Math.abs(mx - parent.x) < 1e-6 && Math.abs(mz - parent.z) < 1e-6;

        if (collapsed) {
          for (const p of points) {
            const gate = p.cavity ? gateById.get(p.cavity.id) : undefined;
            if (gate) {
              addEdge(ctx, parent, gate, depth, diaForDepth(BASE_DIA, depth));
            }
          }
          return;
        }

        const junction = addNode(ctx, 'junction', mx, mz);
        addEdge(ctx, parent, junction, depth, diaForDepth(BASE_DIA, depth));
        for (const p of points) {
          const gate = p.cavity ? gateById.get(p.cavity.id) : undefined;
          if (gate) {
            addEdge(ctx, junction, gate, depth + 1, diaForDepth(BASE_DIA, depth + 1));
          }
        }
        return;
      }

      const sorted = [...points].sort((a, b) => (depth % 2 === 0 ? a.x - b.x : a.z - b.z));
      const half = Math.floor(sorted.length / 2);
      const L = sorted.slice(0, half);
      const R = sorted.slice(half);
      const lc = { x: avg(L, 'x'), z: avg(L, 'z') };
      const rc = { x: avg(R, 'x'), z: avg(R, 'z') };

      const leftJ = addNode(ctx, 'junction', lc.x, lc.z);
      const rightJ = addNode(ctx, 'junction', rc.x, rc.z);
      const parent = ctx.nodes.find((n) => n.id === parentNodeId);
      if (parent) {
        addEdge(ctx, parent, leftJ, depth, diaForDepth(BASE_DIA, depth));
        addEdge(ctx, parent, rightJ, depth, diaForDepth(BASE_DIA, depth));
      }
      build(L, depth + 1, leftJ.id);
      build(R, depth + 1, rightJ.id);
    }

    build(
      cavs.map((c) => ({ x: c.x, z: c.z, cavity: c })),
      0,
      sprue.id,
    );

    return buildTree(ctx);
  },
};

function avg<T extends Record<K, number>, K extends string>(arr: T[], key: K): number {
  return arr.reduce((a, b) => a + b[key], 0) / arr.length;
}
