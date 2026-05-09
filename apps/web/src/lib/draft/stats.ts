/**
 * Surface-area statistics for a per-vertex draft-angle classification.
 *
 * Each triangle's category = the bucket of the average of its three
 * vertex angles (so a triangle straddling positive/undercut counts
 * toward whichever side dominates). Triangle area = 0.5 · |edge1 × edge2|.
 *
 * Returns total mm² per category and the undercut percentage —
 * surfaced in the modal sidebar so the user can see at a glance
 * whether the chosen demoulding direction leaves a manufacturable
 * part or whether they need to rotate the part / re-pick.
 */

import { classifyDraftAngle, type DraftCategory } from './classify';

export interface DraftAreaStats {
  positiveMm2: number;
  marginalMm2: number;
  undercutMm2: number;
  totalMm2: number;
  /** undercutMm2 / totalMm2 × 100, 0 if totalMm2 = 0. */
  undercutPct: number;
}

export function draftAreaStats(
  positions: Float32Array,
  indices: Uint32Array,
  angles: Float32Array,
): DraftAreaStats {
  let pos = 0, mar = 0, unc = 0, tot = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!;
    const ib = indices[i + 1]!;
    const ic = indices[i + 2]!;
    const ax = positions[ia * 3]!,     ay = positions[ia * 3 + 1]!,     az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!,     by = positions[ib * 3 + 1]!,     bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!,     cy = positions[ic * 3 + 1]!,     cz = positions[ic * 3 + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crossX = e1y * e2z - e1z * e2y;
    const crossY = e1z * e2x - e1x * e2z;
    const crossZ = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
    if (!Number.isFinite(area) || area === 0) continue;

    const avgAngle = (angles[ia]! + angles[ib]! + angles[ic]!) / 3;
    const cat: DraftCategory = classifyDraftAngle(avgAngle);
    if (cat === 'positive') pos += area;
    else if (cat === 'marginal') mar += area;
    else unc += area;
    tot += area;
  }

  return {
    positiveMm2: pos,
    marginalMm2: mar,
    undercutMm2: unc,
    totalMm2: tot,
    undercutPct: tot > 0 ? (unc / tot) * 100 : 0,
  };
}
