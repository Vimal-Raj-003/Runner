/**
 * Inline layout — single horizontal row. Simple, unbalanced.
 */

import { addCavity, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';

const SPACING = 80;
const BASE_DIA = 7;

export const inlineLayout: LayoutGenerator = {
  id: 'inline',
  label: 'Inline',
  description: 'Single row, simple but unbalanced',
  balance: 'Unbalanced',
  validate(n) {
    if (n < 2 || n > 8) return { ok: false, reason: 'Inline: 2–8 cavities' };
    return { ok: true };
  },
  generate(n) {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);
    const total = (n - 1) * SPACING;
    for (let i = 0; i < n; i++) {
      const x = -total / 2 + i * SPACING;
      const { node } = addCavity(ctx, x, 0);
      addEdge(ctx, sprue, node, 0, diaForDepth(BASE_DIA, 0));
    }
    return buildTree(ctx);
  },
};
