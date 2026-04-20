/**
 * Apparent wall shear rate and shear stress.
 *
 *  Round channel:         γ̇ = 4 Q / (π r³)
 *  Rectangular gate:      γ̇ = 6 Q / (W · h²)
 *  Shear stress:          τ = η · γ̇
 *
 *  Sources: Rees 2002 §4.3; Menges & Mohren 1993.
 *
 *  Degradation / silver-streak risk: most commodity polymers safe below
 *  ~40 000 s⁻¹ (PE/PS) down to 10 000–20 000 s⁻¹ for PVC/PET. Consult
 *  Material.shearRateMax / shearStressMax for grade-specific limits.
 */

import { cite, type Citation } from '../citations';

export interface ShearResult {
  shearRateS: number;
  shearStressMPa: number;
  citations: { rate: Citation; stress: Citation };
}

export function roundChannelShear(
  volumetricFlowMm3PerS: number,
  diameterMm: number,
  viscosityPaS: number,
): ShearResult {
  const r_m = (diameterMm / 2) * 1e-3;
  const Q_SI = volumetricFlowMm3PerS * 1e-9;
  const gamma = (4 * Q_SI) / (Math.PI * r_m * r_m * r_m);
  const tau = viscosityPaS * gamma;
  return {
    shearRateS: gamma,
    shearStressMPa: tau / 1e6,
    citations: {
      rate: cite('apparent_shear_rate_round'),
      stress: cite('shear_stress'),
    },
  };
}

export function rectGateShear(
  volumetricFlowMm3PerS: number,
  widthMm: number,
  depthMm: number,
  viscosityPaS: number,
): ShearResult {
  const W_SI = widthMm * 1e-3;
  const h_SI = depthMm * 1e-3;
  const Q_SI = volumetricFlowMm3PerS * 1e-9;
  const gamma = (6 * Q_SI) / (W_SI * h_SI * h_SI);
  const tau = viscosityPaS * gamma;
  return {
    shearRateS: gamma,
    shearStressMPa: tau / 1e6,
    citations: {
      rate: cite('apparent_shear_rate_rect'),
      stress: cite('shear_stress'),
    },
  };
}

export interface ShearSafety {
  withinShearRate: boolean;
  withinShearStress: boolean;
  shearRateMarginPct: number;    // (max - actual) / max · 100
  shearStressMarginPct: number;
}

export function assessShearSafety(
  shear: ShearResult,
  maxRate: number,
  maxStress: number,
): ShearSafety {
  return {
    withinShearRate: shear.shearRateS <= maxRate,
    withinShearStress: shear.shearStressMPa <= maxStress,
    shearRateMarginPct: maxRate > 0 ? ((maxRate - shear.shearRateS) / maxRate) * 100 : 0,
    shearStressMarginPct: maxStress > 0 ? ((maxStress - shear.shearStressMPa) / maxStress) * 100 : 0,
  };
}
