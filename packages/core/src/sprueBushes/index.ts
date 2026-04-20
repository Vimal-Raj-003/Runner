import { DME_A_SERIES, DME_B_SERIES, type SprueBush } from './dme';
import { HASCO_Z100, HASCO_Z102, HASCO_Z104 } from './hasco';

export { DME_A_SERIES, DME_B_SERIES, HASCO_Z100, HASCO_Z102, HASCO_Z104 };
export type { SprueBush };

export const ALL_SPRUE_BUSHES: readonly SprueBush[] = [
  ...DME_A_SERIES,
  ...DME_B_SERIES,
  ...HASCO_Z100,
  ...HASCO_Z102,
  ...HASCO_Z104,
];

/**
 * Pick the smallest catalogue bush whose orifice is greater than or equal
 * to the required orifice (nozzle + 0.75 mm per DME/HASCO rule).
 */
export function selectSprueBush(
  requiredOrificeMm: number,
  minLengthMm: number,
  waterCooled = false,
): SprueBush | undefined {
  return ALL_SPRUE_BUSHES
    .filter((b) => b.orificeMm >= requiredOrificeMm && b.lengthMm >= minLengthMm && b.waterCooled === waterCooled)
    .sort((a, b) => a.orificeMm - b.orificeMm || a.lengthMm - b.lengthMm)[0];
}
