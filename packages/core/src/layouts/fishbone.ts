/**
 * Fishbone layouts — central spine with lateral branches.
 *
 *  - Symmetric:           equal pairs left/right, uniform branch dia
 *  - Graduated (stepped): branch dia grows with distance from sprue, to
 *                         partially compensate for natural imbalance
 *  - One-sided:           branches only on one side of the spine
 *
 * Topology — CHAIN:
 *   The spine extends out of the sprue in both directions. Each spine
 *   junction is the *child* of the previous junction (or of the sprue for
 *   the closest junction on each side). This means edge.lenMm reflects the
 *   incremental segment length, so:
 *      Section 1 (sprue → 1st junction)  =  L1 mm
 *      Section 2 (1st → 2nd junction)    =  L2 mm
 *      Sprue → 2nd junction              =  L1 + L2 mm  (cumulative, derived)
 *
 *   For odd cavity counts the sprue itself acts as the middle "junction"
 *   so the middle pair branches directly from the sprue (no zero-length
 *   spine edge).
 */

import { addCavityWithDrop, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';
import type { RunnerNode } from '../geometry/tree';

const SPINE_DY = 80;
const BRANCH_DX = 120;
const SPINE_DIA = 9;
const BRANCH_DIA_BASE = 6;

function fishSym(n: number, stepped: boolean) {
  return {
    generate() {
      const ctx = newContext();
      const sprue = addNode(ctx, 'sprue', 0, 0);
      const pairs = n / 2;

      // Distribute pairs above/below the sprue. Odd pairs put the centre
      // pair directly on the sprue so the spine never has a zero-length
      // edge (which the calc engine would later filter out anyway).
      const halfFloor = Math.floor(pairs / 2);
      const middleAtSprue = pairs % 2 === 1;

      // Build the chain ABOVE the sprue (negative-z direction). Order in
      // `aboveNodes` runs from sprue outward (closest to farthest).
      const aboveNodes: RunnerNode[] = [];
      let prev: RunnerNode = sprue;
      for (let i = 0; i < halfFloor; i++) {
        const z = -(i + 1) * SPINE_DY;
        const node = addNode(ctx, 'junction', 0, z);
        addEdge(ctx, prev, node, 0, SPINE_DIA);
        aboveNodes.push(node);
        prev = node;
      }

      // Build the chain BELOW the sprue (positive-z direction).
      const belowNodes: RunnerNode[] = [];
      prev = sprue;
      for (let i = 0; i < halfFloor; i++) {
        const z = (i + 1) * SPINE_DY;
        const node = addNode(ctx, 'junction', 0, z);
        addEdge(ctx, prev, node, 0, SPINE_DIA);
        belowNodes.push(node);
        prev = node;
      }

      // Anchors top → bottom: reverse aboveNodes (so the farthest-top junction
      // is index 0), insert sprue if odd, then the below chain in order.
      const anchors: RunnerNode[] = [
        ...[...aboveNodes].reverse(),
        ...(middleAtSprue ? [sprue] : []),
        ...belowNodes,
      ];

      // Cavity branches — graduated diameter walks linearly from top to bottom
      // when `stepped` is true. Each cavity gets a gate-junction + drop edge
      // so per-cavity drop dia/len is tunable by the auto-balance solver.
      const span = Math.max(anchors.length - 1, 1);
      const dropDepth = 2; // sub = depth 1; drops sit one level deeper
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i]!;
        const z = anchor.z;
        const { gate: leftGate }  = addCavityWithDrop(ctx, -BRANCH_DX, z, dropDepth);
        const { gate: rightGate } = addCavityWithDrop(ctx,  BRANCH_DX, z, dropDepth);

        const branchDia = stepped
          ? diaForDepth(BRANCH_DIA_BASE + 2 * (i / span), 1)
          : diaForDepth(BRANCH_DIA_BASE, 1);

        addEdge(ctx, anchor, leftGate, 1, branchDia);
        addEdge(ctx, anchor, rightGate, 1, branchDia);
      }

      return buildTree(ctx);
    },
  };
}

export const fishSymLayout: LayoutGenerator = {
  id: 'fish_sym',
  label: 'Fishbone Sym',
  description: 'Central spine with equal branch pairs',
  balance: 'Artificial',
  validate(n) {
    if (n < 4 || n % 2 !== 0) {
      return { ok: false, reason: 'Fishbone symmetric requires an even number ≥ 4' };
    }
    return { ok: true };
  },
  generate(n) {
    return fishSym(n, false).generate();
  },
};

export const fishStepLayout: LayoutGenerator = {
  id: 'fish_step',
  label: 'Fishbone Grad Ø',
  description: 'Graduated branch diameters to balance fill',
  balance: 'Artificial',
  // Hidden everywhere — the "graduated" branch-Ø ramp is now subsumed by
  // the multi-objective auto-balancer running on Fishbone Sym, which can
  // produce per-section Ø differentiation on demand. The variant is kept
  // only so existing user state (layoutId='fish_step') still resolves.
  hidden: true,
  validate(n) {
    if (n < 4 || n % 2 !== 0) {
      return { ok: false, reason: 'Fishbone graduated requires an even number ≥ 4' };
    }
    return { ok: true };
  },
  generate(n) {
    return fishSym(n, true).generate();
  },
};

export const fishOneLayout: LayoutGenerator = {
  id: 'fish_one',
  label: 'Fishbone 1-Side',
  description: 'All branches one side, compact',
  balance: 'Unbalanced',
  validate(n) {
    if (n < 3 || n > 16) return { ok: false, reason: 'Fishbone 1-side: 3–16 cavities' };
    return { ok: true };
  },
  generate(n) {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);

    // Chain layout: same structure as fishSym but each anchor gets only
    // ONE cavity (on the +x side). For odd n the middle cavity sits on
    // the sprue's z-axis level and branches directly from it.
    const halfFloor = Math.floor(n / 2);
    const middleAtSprue = n % 2 === 1;

    const aboveNodes: RunnerNode[] = [];
    let prev: RunnerNode = sprue;
    for (let i = 0; i < halfFloor; i++) {
      const z = -(i + 1) * SPINE_DY;
      const node = addNode(ctx, 'junction', 0, z);
      addEdge(ctx, prev, node, 0, SPINE_DIA);
      aboveNodes.push(node);
      prev = node;
    }

    const belowNodes: RunnerNode[] = [];
    prev = sprue;
    for (let i = 0; i < halfFloor; i++) {
      const z = (i + 1) * SPINE_DY;
      const node = addNode(ctx, 'junction', 0, z);
      addEdge(ctx, prev, node, 0, SPINE_DIA);
      belowNodes.push(node);
      prev = node;
    }

    const anchors: RunnerNode[] = [
      ...[...aboveNodes].reverse(),
      ...(middleAtSprue ? [sprue] : []),
      ...belowNodes,
    ];

    const dropDepth = 2;
    for (const anchor of anchors) {
      const { gate } = addCavityWithDrop(ctx, BRANCH_DX, anchor.z, dropDepth);
      addEdge(ctx, anchor, gate, 1, diaForDepth(BRANCH_DIA_BASE, 1));
    }
    return buildTree(ctx);
  },
};
