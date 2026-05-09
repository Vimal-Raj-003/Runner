/**
 * Single-cavity layout — sprue feeds one cavity directly. No runner
 * network: the drop is the only segment between sprue and cavity.
 *
 * Used for prototype tools, large parts that don't fit a multi-cavity
 * layout, or single-impression test moulds. The drop edge carries the
 * 55 mm vertical extent in `lenMm`; in 2D the parent (sprue) and child
 * (cavity) share xz at the origin.
 */

import {
  addDropOnlyCavity,
  addNode,
  buildTree,
  newContext,
} from './build';
import type { LayoutGenerator } from './types';

export const singleLayout: LayoutGenerator = {
  id: 'single',
  label: 'Single Cavity',
  description: 'One cavity directly under the sprue — prototype / large-part moulds',
  balance: 'Natural',
  validate(n) {
    if (n !== 1) return { ok: false, reason: 'Single Cavity: exactly 1 cavity' };
    return { ok: true };
  },
  generate() {
    const ctx = newContext();
    const sprue = addNode(ctx, 'sprue', 0, 0);
    addDropOnlyCavity(ctx, sprue, 0, 0, 1);
    return buildTree(ctx);
  },
};
