/**
 * Sprue-bush calculations per DME / HASCO practice.
 *
 *   orifice = nozzle_dia + 0.75 mm         (DME standard clearance)
 *   exit_dia = orifice + 2 · L · tan(θ/2)  (with θ = included taper angle)
 *   V_sprue = (π · L / 3) · (r₀² + r₀·r₁ + r₁²)   (frustum volume)
 *
 *  Default taper: 2° included (HASCO Z100, DME A-series).
 */

import { cite } from '../citations';

export interface SprueInput {
  nozzleDiaMm: number;
  sprueLengthMm: number;
  includedTaperDeg?: number; // default 2
}

export interface SprueResult {
  orificeMm: number;
  exitDiaMm: number;
  taperDeg: number;
  volumeMm3: number;
  citation: ReturnType<typeof cite>;
}

export function computeSprue(input: SprueInput): SprueResult {
  const taperDeg = input.includedTaperDeg ?? 2;
  const orifice = input.nozzleDiaMm + 0.75;
  const halfTaperRad = (taperDeg * Math.PI) / 180 / 2;
  const exitDia = orifice + 2 * input.sprueLengthMm * Math.tan(halfTaperRad);
  const r0 = orifice / 2;
  const r1 = exitDia / 2;
  const volume = (Math.PI * input.sprueLengthMm / 3) * (r0 * r0 + r0 * r1 + r1 * r1);
  return {
    orificeMm: orifice,
    exitDiaMm: exitDia,
    taperDeg,
    volumeMm3: volume,
    citation: cite('dme_sprue_taper'),
  };
}
