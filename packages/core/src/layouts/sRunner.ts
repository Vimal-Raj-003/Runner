/**
 * S-Runner — two-cavity S-sweep, naturally balanced mirror.
 */

import { addCavityWithDrop, addEdge, addNode, buildTree, newContext } from './build';
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
    const { gate: leftGate } = addCavityWithDrop(ctx, -SX, 0, 1);
    addEdge(ctx, sprue, leftBend, 0, MAIN_DIA);
    addEdge(ctx, leftBend, leftGate, 0, MAIN_DIA);

    // Right arm with opposite mid-bend
    const rightBend = addNode(ctx, 'junction', mid, mid * 0.6);
    const { gate: rightGate } = addCavityWithDrop(ctx, SX, 0, 1);
    addEdge(ctx, sprue, rightBend, 0, MAIN_DIA);
    addEdge(ctx, rightBend, rightGate, 0, MAIN_DIA);

    return buildTree(ctx);
  },
};
