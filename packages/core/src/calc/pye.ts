/**
 * Pye runner-diameter correlation.
 *
 *     D = ⁴√(W · L) / K      (K nominally 3.7; 3.6–3.8 range)
 *
 *  W = part weight per cavity [g]
 *  L = runner length from sprue to cavity [mm]
 *  D = recommended runner diameter [mm]
 *
 *  Source: Rosato, Injection Molding Handbook (2000), §3.2.
 *  Also reproduced in Nayak 2012 Table 2.12 (as a range bounded by
 *  viscosity class).
 *
 *  Limits: empirically valid for L < 150 mm and W < 20 cm².
 */

import { cite } from '../citations';

export interface PyeInput {
  partWeightG: number;
  runnerLengthMm: number;
  constantK?: number; // default 3.7
}

export interface PyeResult {
  diameterMm: number;
  constantK: number;
  citation: ReturnType<typeof cite>;
}

export function pyeRunnerDiameter(input: PyeInput): PyeResult {
  const K = input.constantK ?? 3.7;
  const D = Math.pow(input.partWeightG, 0.25) * Math.pow(input.runnerLengthMm, 0.25) / K;
  return {
    diameterMm: D,
    constantK: K,
    citation: cite('pye_runner_dia'),
  };
}

/**
 * Snap computed diameter to the nearest standard drill size in 0.5 mm
 * increments, clamped to the Nayak recommended range [3, 13] mm.
 */
export function roundToStandardDiameter(dMm: number): number {
  return Math.max(3, Math.min(13, Math.round(dMm * 2) / 2));
}
