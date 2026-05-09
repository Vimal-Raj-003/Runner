/**
 * Cross-Main layout — 4 arms from sprue, cavities offset perpendicular
 * to each arm. Used for high-cavity moulds (12–48).
 *
 * Topology: each arm is a CHAIN — sprue → branch₁ → branch₂ → … → branchₖ.
 * Sub-runners drop off each branch node to a cavity offset perpendicular
 * to the arm. Two reasons we use a chain rather than a star-from-sprue:
 *
 *   1. Section labelling. Chain segments have distinct chainPos values
 *      (1, 2, 3, …), so Main Runner Section 1 = innermost ring, Section 2
 *      = middle ring, etc. With a star, every main edge had chainPos 1 and
 *      Section 1 had to be inferred from segment length, which produced
 *      overlapping geometry that hid the highlight.
 *   2. 3D rendering. Chain segments don't overlap; each is a distinct
 *      tube along the arm. Star edges all started at sprue and ran past
 *      one another along the same axis, so highlighting the inner section
 *      was hidden under the dimmed outer-section meshes.
 */

import { addCavityWithDrop, addEdge, addNode, buildTree, diaForDepth, newContext } from './build';
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

      // Chain along the arm: every branch node's parent is the previous
      // node, so Section 1 (sprue → branch₁) is incremental, not cumulative.
      let prev = sprue;
      for (let i = 0; i < count && produced < n; i++) {
        const pos = (i + 1) * SY;
        const bx = dir.dx * pos;
        const bz = dir.dz * pos;
        const branchNode = addNode(ctx, 'junction', bx, bz);
        addEdge(ctx, prev, branchNode, 0, MAIN_DIA);
        prev = branchNode;

        // Cavity offset perpendicular to the arm direction.
        const px = dir.dz * SX;
        const pz = -dir.dx * SX;
        const { gate } = addCavityWithDrop(ctx, bx + px, bz + pz, 2);
        addEdge(ctx, branchNode, gate, 1, diaForDepth(MAIN_DIA, 1));
        produced++;
      }
    }
    return buildTree(ctx);
  },
};
