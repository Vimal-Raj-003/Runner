/**
 * Inline layout — single horizontal row. Simple, unbalanced.
 *
 * Topology: CHAIN-per-side. The main runner extends out of the sprue in
 * both directions, with each gate junction parented to its inner neighbour
 * (or to the sprue for the innermost gate on each side). This means every
 * Section corresponds to a *physical incremental segment* of the runner:
 *
 *   • Section 1 (chainPos 1) — sprue → innermost gate on each side. Two
 *     edges meeting at the sprue, so when highlighted they look like one
 *     continuous bar passing through the centre.
 *   • Section 2 (chainPos 2) — innermost gate → next-outer gate, on each
 *     side. Two edges that DON'T touch the sprue, so when highlighted they
 *     appear as two separated bars at the outer ends.
 *   • Section 3, 4, … for higher cavity counts (N ≥ 6).
 *
 * For odd N the middle cavity coincides with the sprue, so its drop is
 * branched directly off the sprue via `addDropOnlyCavity` — no zero-length
 * main edge. Drop class counts after this fix:
 *   N=3 → 2 (middle + outer pair),  N=4 → 2,  N=5 → 3 (middle + 2 tiers),
 *   N=6 → 3,  N=7 → 4,  N=8 → 4.
 */

import { addCavityWithDrop, addDropOnlyCavity, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';
import type { RunnerNode } from '../geometry/tree';

const SPACING = 80;
const BASE_DIA = 7;

export const inlineLayout: LayoutGenerator = {
  id: 'inline',
  label: 'Inline',
  description: 'Single row, simple but unbalanced',
  balance: 'Unbalanced',
  // At N=2 the user wants only H-Bridge and S-Runner exposed — Inline at
  // 2 cavities is just two cavities side-by-side off the sprue, which is
  // visually the same as 2-cav H-Bridge.
  hiddenAtN: [2],
  validate(n) {
    if (n < 2 || n > 8) return { ok: false, reason: 'Inline: 2–8 cavities' };
    return { ok: true };
  },
  generate(n) {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);
    const total = (n - 1) * SPACING;

    // Bucket cavity x-positions into left / right of the sprue, then sort
    // each side from innermost (closest to sprue) to outermost so we can
    // chain them in order.
    const leftXs: number[] = [];
    const rightXs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = -total / 2 + i * SPACING;
      if (Math.abs(x) < 1e-6) continue; // middle handled below
      if (x < 0) leftXs.push(x);
      else rightXs.push(x);
    }
    leftXs.sort((a, b) => Math.abs(a) - Math.abs(b));
    rightXs.sort((a, b) => Math.abs(a) - Math.abs(b));

    // Odd N — middle cavity sits on the sprue; branch its drop directly.
    if (n % 2 === 1) {
      addDropOnlyCavity(ctx, sprue, 0, 0, 1);
    }

    // Build a chain per side: each new gate's parent is the previous gate
    // (or the sprue for the innermost). Section labels then map directly
    // to incremental chain positions and the 3D viewer's spotlight covers
    // exactly the segment(s) the user clicked.
    const chain = (xs: number[]): void => {
      let prev: RunnerNode = sprue;
      for (const x of xs) {
        const { gate } = addCavityWithDrop(ctx, x, 0, 1);
        addEdge(ctx, prev, gate, 0, diaForDepth(BASE_DIA, 0));
        prev = gate;
      }
    };
    chain(leftXs);
    chain(rightXs);

    return buildTree(ctx);
  },
};
