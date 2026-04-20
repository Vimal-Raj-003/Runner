/**
 * Clamp-force estimate.
 *
 *     F [tonne-force] = A_proj · P_inj / 10 000
 *
 *  A_proj is the total projected cavity + runner area in mm².
 *  P_inj is the peak injection pressure in bar (1 bar = 0.1 MPa).
 *  Division by 10 000 converts (mm² · bar) / 1e4 → tonne-force.
 *
 *  Source: Rees, Mold Engineering 2e (2002), §4.
 */

import { cite } from '../citations';

export interface ClampInput {
  projectedAreaMm2: number;   // projected area of all cavities + runners
  injectionPressureBar: number;
  safetyFactor?: number;       // default 1.1
}

export interface ClampResult {
  clampForceTonne: number;
  clampForceKN: number;
  safetyFactor: number;
  citation: ReturnType<typeof cite>;
}

export function computeClampForce(input: ClampInput): ClampResult {
  const sf = input.safetyFactor ?? 1.1;
  const baseTonne = (input.projectedAreaMm2 * input.injectionPressureBar) / 10000;
  const tonne = baseTonne * sf;
  const kN = tonne * 9.80665; // 1 tonne-force = 9.80665 kN
  return {
    clampForceTonne: tonne,
    clampForceKN: kN,
    safetyFactor: sf,
    citation: cite('clamp_force_simple'),
  };
}
