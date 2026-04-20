/**
 * S-Runner — two-cavity S-sweep, naturally balanced mirror.
 */

import { addCavity, addEdge, addNode, buildTree, newContext } from './build';
import type { LayoutGenerator } from './types';

const SX = 120;
const MAIN_DIA = 7;

export const sRunnerLayout: LayoutGenerator = {
  id: 's_runner',
  label: 'S-Runner',
  description: 'S-sweep to two end gates',
  balance: 'Natural',
  validate(n) {
    return n === 2 ? { ok: true } : { ok: false, reason: 'S-Runner only valid for n = 2' };
  },
  generate() {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);

    const mid = SX * 0.5;
    // Left arm with mid-bend
    const leftBend = addNode(ctx, 'junction', -mid, -mid * 0.6);
    const { node: leftCav } = addCavity(ctx, -SX, 0);
    addEdge(ctx, sprue, leftBend, 0, MAIN_DIA);
    addEdge(ctx, leftBend, leftCav, 0, MAIN_DIA);

    // Right arm with opposite mid-bend
    const rightBend = addNode(ctx, 'junction', mid, mid * 0.6);
    const { node: rightCav } = addCavity(ctx, SX, 0);
    addEdge(ctx, sprue, rightBend, 0, MAIN_DIA);
    addEdge(ctx, rightBend, rightCav, 0, MAIN_DIA);

    return buildTree(ctx);
  },
};
