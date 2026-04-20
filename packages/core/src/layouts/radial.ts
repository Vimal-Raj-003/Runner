/**
 * Radial / Star layout — arms from sprue to each cavity, naturally balanced.
 */

import { addCavity, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';

const BASE_DIA = 7;

export const radialLayout: LayoutGenerator = {
  id: 'radial',
  label: 'Radial/Star',
  description: 'Arms from centre, balanced for any N',
  balance: 'Natural',

  validate(n) {
    if (n < 2) return { ok: false, reason: 'Radial requires ≥ 2 cavities' };
    if (n > 24) return { ok: false, reason: 'Radial becomes impractical above 24 cavities' };
    return { ok: true };
  },

  generate(n) {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);
    const radius = Math.max(100, n * 28); // mm

    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI / n) * i - Math.PI / 2;
      const x = radius * Math.cos(ang);
      const z = radius * Math.sin(ang);
      const { node } = addCavity(ctx, x, z);
      addEdge(ctx, sprue, node, 0, diaForDepth(BASE_DIA, 0));
    }

    return buildTree(ctx);
  },
};
