/**
 * Cross-Main layout — 4 arms from sprue, cavities offset perpendicular
 * to each arm. Used for high-cavity moulds (12–48).
 */

import { addCavity, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
import type { LayoutGenerator } from './types';

const SX = 70;
const SY = 70;
const MAIN_DIA = 8;

export const crossMainLayout: LayoutGenerator = {
  id: 'cross_main',
  label: 'Cross Main',
  description: 'Cross-shaped manifold for high cavity counts',
  balance: 'Artificial',
  validate(n) {
    if (n < 12 || n > 48) return { ok: false, reason: 'Cross Main: 12–48 cavities' };
    return { ok: true };
  },
  generate(n) {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);

    const dirs = [
      { dx: 1, dz: 0 },
      { dx: -1, dz: 0 },
      { dx: 0, dz: 1 },
      { dx: 0, dz: -1 },
    ];
    const perArm = Math.ceil(n / 4);
    let produced = 0;

    for (let armIdx = 0; armIdx < 4; armIdx++) {
      const dir = dirs[armIdx]!;
      const count = armIdx < (n % 4 || 4) ? perArm : Math.floor(n / 4);
      if (count === 0) continue;

      const armLen = count * SY;
      const armTip = addNode(ctx, 'junction', dir.dx * armLen, dir.dz * armLen);
      addEdge(ctx, sprue, armTip, 0, MAIN_DIA);

      for (let i = 0; i < count && produced < n; i++) {
        const pos = (i + 1) * SY;
        const bx = dir.dx * pos;
        const bz = dir.dz * pos;
        const branchNode = addNode(ctx, 'junction', bx, bz);
        // Connect via sprue (simplified — still correct for calc, a dedicated
        // arm-chain structure is a future optimisation).
        addEdge(ctx, sprue, branchNode, 0, MAIN_DIA);

        const px = dir.dz * SX;
        const pz = -dir.dx * SX;
        const { node: cav } = addCavity(ctx, bx + px, bz + pz);
        addEdge(ctx, branchNode, cav, 1, diaForDepth(MAIN_DIA, 1));
        produced++;
      }
    }
    return buildTree(ctx);
  },
};
