/**
 * Industrial material-record schema.
 *
 * Properties follow the intersection of CAMPUS, Moldflow MatDB and
 * Moldex3D material cards. The minimum set required to run the full
 * calculation pipeline is marked Required; Cross-WLF coefficients are
 * optional and fall back to a power-law model when absent.
 */

import type { Citation } from '../citations';

export type MaterialGroup = 'PE_PS' | 'POM_PC_PP' | 'CA_PMMA_PA' | 'PVC';

export const MATERIAL_GROUPS: Record<
  MaterialGroup,
  { label: string; n: number; viscosity: 'low' | 'medium' | 'high' }
> = {
  PE_PS:       { label: 'PE, PS',           n: 0.6, viscosity: 'low' },
  POM_PC_PP:   { label: 'POM, PC, PP',      n: 0.7, viscosity: 'low' },
  CA_PMMA_PA:  { label: 'CA, PMMA, Nylon',  n: 0.8, viscosity: 'high' },
  PVC:         { label: 'PVC',              n: 0.9, viscosity: 'high' },
};

/** Power-law viscosity model: η = K · γ̇^(n − 1) */
export interface PowerLawModel {
  readonly K: number;  // Pa·sⁿ
  readonly n: number;  // shear-thinning index, 0–1
}

/** Cross-WLF viscosity model (Moldflow canonical form). */
export interface CrossWLFModel {
  readonly eta0: number;    // Pa·s at zero shear, reference T
  readonly tauStar: number; // Pa
  readonly n: number;       // 0–1
  readonly Tstar: number;   // K
  readonly D1: number;
  readonly D2: number;
  readonly D3: number;
  readonly A1: number;
  readonly A2: number;      // K
}

export type MaterialSource = 'CAMPUS' | 'vendor' | 'literature' | 'user';

export interface Material {
  readonly id: string;
  readonly family: string;          // "PP", "ABS", "PC", …
  readonly grade: string;           // "Homopolymer", "Flame-retardant", …
  readonly group: MaterialGroup;

  // Core physical
  readonly rhoMelt: number;         // kg/m³ at processing T
  readonly rhoSolid: number;        // kg/m³ at 23 °C

  // Thermal
  readonly tMeltMin: number;        // °C
  readonly tMeltMax: number;        // °C
  readonly tMouldMin: number;       // °C
  readonly tMouldMax: number;       // °C
  readonly tEject: number;          // °C (ejection / dimensional stability)
  readonly cp: number;              // J/(kg·K)
  readonly lambda: number;          // W/(m·K)
  readonly alpha?: number;          // mm²/s (optional; computed if absent)

  // Rheology
  readonly viscosityModel: 'power_law' | 'cross_wlf';
  readonly powerLaw?: PowerLawModel;
  readonly crossWLF?: CrossWLFModel;

  // Stability limits
  readonly shearRateMax: number;    // s⁻¹
  readonly shearStressMax: number;  // MPa

  // Legacy constant for h = n·t formula
  readonly gateConstantN: number;

  // Provenance
  readonly source: MaterialSource;
  readonly reference?: string;
  readonly citation?: Citation;
}

/**
 * Thermal diffusivity α = λ / (ρ · cp).
 * Returned in mm²/s for direct use in Menges freeze-time formula.
 */
export function thermalDiffusivity(mat: Material): number {
  if (mat.alpha !== undefined) return mat.alpha;
  const alphaSI = mat.lambda / (mat.rhoSolid * mat.cp); // m²/s
  return alphaSI * 1e6; // mm²/s
}

/**
 * Apparent viscosity η(γ̇, T).
 *
 * Uses Cross-WLF if available; otherwise falls back to power-law.
 * If neither is set, uses a conservative generic estimate.
 */
export function apparentViscosity(mat: Material, shearRate: number, tempK: number): number {
  if (mat.viscosityModel === 'cross_wlf' && mat.crossWLF) {
    const { eta0, tauStar, n, D1, D2, D3, A1, A2 } = mat.crossWLF;
    // Pressure term P omitted (set P = 0)
    const Tstar = D2 + D3 * 0;
    const eta0T = D1 * Math.exp(-(A1 * (tempK - Tstar)) / (A2 + (tempK - Tstar)));
    const eta_inf = eta0T;
    const denom = 1 + Math.pow((eta_inf * shearRate) / tauStar, 1 - n);
    return eta_inf / denom || eta0;
  }
  if (mat.powerLaw) {
    const { K, n } = mat.powerLaw;
    if (shearRate <= 0) return K;
    return K * Math.pow(shearRate, n - 1);
  }
  // Generic conservative estimate (typical commodity polymer)
  return 500;
}
