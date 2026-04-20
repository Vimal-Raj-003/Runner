/**
 * T-Runner — horizontal main bar + vertical drops to each cavity.
 */

import { addCavity, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';

const SX = 100;
const SY = 80;
const MAIN_DIA = 9;

export const tRunnerLayout: LayoutGenerator = {
  id: 't_runner',
  label: 'T-Runner',
  description: 'T-shaped main with branch drops',
  balance: 'Artificial',
  validate(n) {
    if (n < 4 || n > 12 || n % 2 !== 0) {
      return { ok: false, reason: 'T-Runner: even count 4–12' };
    }
    return { ok: true };
  },
  generate(n) {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);

    const cols = Math.min(n, 4);
    const rows = Math.ceil(n / cols);

    type Anchor = { node: ReturnType<typeof addNode>; x: number };
    const anchors: Anchor[] = [];

    const minX = -(cols - 1) / 2 * SX;
    const maxX = +(cols - 1) / 2 * SX;
    // Main bar endpoints
    const leftMain = addNode(ctx, 'junction', minX, 0);
    const rightMain = addNode(ctx, 'junction', maxX, 0);
    addEdge(ctx, sprue, leftMain, 0, MAIN_DIA);
    addEdge(ctx, sprue, rightMain, 0, MAIN_DIA);

    // Drop anchors on the main bar at each cavity's x coordinate
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * SX;
      const a = addNode(ctx, 'junction', x, 0);
      if (Math.abs(x) > 1e-6) addEdge(ctx, sprue, a, 0, MAIN_DIA);
      anchors.push({ node: a, x });
    }

    let count = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols && count < n; c++) {
        const x = (c - (cols - 1) / 2) * SX;
        const z = (r - (rows - 1) / 2) * SY;
        const { node: cav } = addCavity(ctx, x, z);
        const anchor = anchors[c]!;
        addEdge(ctx, anchor.node, cav, 1, diaForDepth(MAIN_DIA, 1));
        count++;
      }
    }
    return buildTree(ctx);
  },
};
