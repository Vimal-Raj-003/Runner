/**
 * Fishbone layouts — central spine with lateral branches.
 *
 *  - Symmetric:           equal pairs left/right, uniform branch dia
 *  - Graduated (stepped): branch dia grows with distance from sprue, to
 *                         partially compensate for natural imbalance
 *  - One-sided:           branches only on one side of the spine
 */

import { addCavity, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';

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
      const spineLen = (pairs - 1) * SPINE_DY;

      // Spine endpoints (two nodes on the Z axis)
      const topSpine = addNode(ctx, 'junction', 0, -spineLen / 2);
      const botSpine = addNode(ctx, 'junction', 0, spineLen / 2);
      addEdge(ctx, sprue, topSpine, 0, SPINE_DIA);
      addEdge(ctx, sprue, botSpine, 0, SPINE_DIA);

      for (let i = 0; i < pairs; i++) {
        const z = -spineLen / 2 + i * SPINE_DY;
        const spineNode = addNode(ctx, 'junction', 0, z);
        // Connect this spine node into the spine chain via sprue (star-style
        // from root — functionally equivalent for calc purposes)
        if (i !== 0 && i !== pairs - 1) {
          addEdge(ctx, sprue, spineNode, 0, SPINE_DIA);
        }

        const { node: leftCav }  = addCavity(ctx, -BRANCH_DX, z);
        const { node: rightCav } = addCavity(ctx,  BRANCH_DX, z);

        const branchDia = stepped
          ? diaForDepth(BRANCH_DIA_BASE + 2 * (i / Math.max(pairs - 1, 1)), 1)
          : diaForDepth(BRANCH_DIA_BASE, 1);

        const anchor = i === 0 ? topSpine : i === pairs - 1 ? botSpine : spineNode;
        addEdge(ctx, anchor, leftCav, 1, branchDia);
        addEdge(ctx, anchor, rightCav, 1, branchDia);
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
    const spineLen = (n - 1) * SPINE_DY;
    const topSpine = addNode(ctx, 'junction', 0, -spineLen / 2);
    const botSpine = addNode(ctx, 'junction', 0, spineLen / 2);
    addEdge(ctx, sprue, topSpine, 0, SPINE_DIA);
    addEdge(ctx, sprue, botSpine, 0, SPINE_DIA);

    for (let i = 0; i < n; i++) {
      const z = -spineLen / 2 + i * SPINE_DY;
      const { node } = addCavity(ctx, BRANCH_DX, z);
      const anchor = i === 0 ? topSpine : i === n - 1 ? botSpine : addNode(ctx, 'junction', 0, z);
      if (i !== 0 && i !== n - 1) addEdge(ctx, sprue, anchor, 0, SPINE_DIA);
      addEdge(ctx, anchor, node, 1, diaForDepth(BRANCH_DIA_BASE, 1));
    }
    return buildTree(ctx);
  },
};
