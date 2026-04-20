/**
 * Cavity overlap detection — O(n²) pairwise with AABB short-circuit.
 * Ports the prototype's lines 482–510 but works in mm (not scene units).
 */

import type { Cavity } from './tree';

export interface CavityOverlap {
  readonly i: number;
  readonly j: number;
  readonly overlapXmm: number;
  readonly overlapZmm: number;
}

export function detectCavityOverlaps(
  cavities: readonly Cavity[],
  cavWmm: number,
  cavDmm: number,
): CavityOverlap[] {
  const out: CavityOverlap[] = [];
  for (let i = 0; i < cavities.length; i++) {
    const a = cavities[i]!;
    for (let j = i + 1; j < cavities.length; j++) {
      const b = cavities[j]!;
      const dxMm = Math.abs(a.x - b.x);
      const dzMm = Math.abs(a.z - b.z);
      const ox = Math.max(0, cavWmm - dxMm);
      const oz = Math.max(0, cavDmm - dzMm);
      if (ox > 0 && oz > 0) {
        out.push({
          i,
          j,
          overlapXmm: Math.round(ox * 10) / 10,
          overlapZmm: Math.round(oz * 10) / 10,
        });
      }
    }
  }
  return out;
}

/** Convenience: set of cavity indices that participate in at least one overlap. */
export function overlapCavityIds(overlaps: readonly CavityOverlap[]): ReadonlySet<number> {
  const s = new Set<number>();
  for (const o of overlaps) {
    s.add(o.i);
    s.add(o.j);
  }
  return s;
}
