/**
 * Thermal calculations — fill time, freeze time, temperature drop,
 * frozen-layer thickness.
 *
 *  Fill time (simplified):
 *      t_fill = V_cav / (ρ · v_gate)         with v_gate ≈ √(2 ΔP / ρ)
 *
 *  Freeze time (Menges & Ballman 1986, classical plate model):
 *      t_c = s² / (π² · α) · ln[(4/π)(T_m − T_w)/(T_e − T_w)]
 *      where
 *        s  = wall thickness (mm)  (also used as half-runner in some refs)
 *        α  = thermal diffusivity  (mm²/s)
 *        T_m, T_w, T_e = melt, mould, ejection temperatures (°C)
 *
 *  Temperature drop along a runner (lumped-parameter heat transfer):
 *      ΔT = (T₀ − T_w) · exp(−h · A / (ṁ · cp))
 *
 *  Frozen-layer thickness (first-order, Menges 1993):
 *      δ_frozen ≈ 2 · √(α · t_fill)
 */

import { cite, type Citation } from '../citations';
import { thermalDiffusivity, type Material } from '../materials/schema';

export interface FillTimeInput {
  cavityVolumeMm3: number;
  deltaPMPa: number;           // ΔP from injection pressure
  meltDensityKgM3: number;
  dischargeCoeff?: number;     // Cd, default 0.62 (orifice)
}

export interface FillTimeResult {
  fillTimeS: number;
  gateVelocityMS: number;
  citation: Citation;
}

export function computeFillTime(input: FillTimeInput): FillTimeResult {
  const deltaP_Pa = input.deltaPMPa * 1e6;
  const rho = input.meltDensityKgM3;
  const Cd = input.dischargeCoeff ?? 0.62;
  const vGate = Cd * Math.sqrt((2 * deltaP_Pa) / rho); // m/s
  const V_SI = input.cavityVolumeMm3 * 1e-9;
  // Fill time = volume / (velocity · reference-area).  Without a concrete
  // gate cross-section this reduces to V / (ρ · v) when working with
  // mass-based flow, which is the simplified form we use for pre-design.
  const tFill = V_SI / (vGate > 0 ? vGate : 1e-9);
  return {
    fillTimeS: Math.max(0, tFill),
    gateVelocityMS: vGate,
    citation: cite('fill_time'),
  };
}

export interface FreezeTimeInput {
  wallThicknessMm: number;
  meltTempC: number;
  mouldTempC: number;
  ejectionTempC: number;
  material: Material;
}

export interface FreezeTimeResult {
  freezeTimeS: number;
  thermalDiffusivityMm2PerS: number;
  citation: Citation;
}

export function computeFreezeTime(input: FreezeTimeInput): FreezeTimeResult {
  const s = input.wallThicknessMm;
  const alpha = thermalDiffusivity(input.material);   // mm²/s
  const Tm = input.meltTempC;
  const Tw = input.mouldTempC;
  const Te = input.ejectionTempC;

  const denominator = Te - Tw;
  const numerator = Tm - Tw;
  if (denominator <= 0 || numerator <= 0) {
    return {
      freezeTimeS: 0,
      thermalDiffusivityMm2PerS: alpha,
      citation: cite('menges_freeze_time'),
    };
  }

  const term = (4 / Math.PI) * (numerator / denominator);
  if (term <= 0) {
    return {
      freezeTimeS: 0,
      thermalDiffusivityMm2PerS: alpha,
      citation: cite('menges_freeze_time'),
    };
  }

  const t_c = (s * s) / (Math.PI * Math.PI * alpha) * Math.log(term);
  return {
    freezeTimeS: Math.max(0, t_c),
    thermalDiffusivityMm2PerS: alpha,
    citation: cite('menges_freeze_time'),
  };
}

export interface MeltTempDropInput {
  meltTempInletC: number;
  mouldTempC: number;
  runnerSurfaceAreaMm2: number;
  massFlowKgPerS: number;
  material: Material;
  heatTransferCoeffWm2K?: number;  // default 200 W/(m²·K) for a melt/steel interface
}

export interface MeltTempDropResult {
  deltaTC: number;
  outletTempC: number;
  citation: Citation;
}

export function computeMeltTempDrop(input: MeltTempDropInput): MeltTempDropResult {
  const h = input.heatTransferCoeffWm2K ?? 200;
  const A = input.runnerSurfaceAreaMm2 * 1e-6; // m²
  const mDot = input.massFlowKgPerS;
  const cp = input.material.cp;
  if (mDot <= 0 || cp <= 0) {
    return {
      deltaTC: 0,
      outletTempC: input.meltTempInletC,
      citation: cite('melt_temp_drop'),
    };
  }
  const ratio = Math.exp(-(h * A) / (mDot * cp));
  const deltaT = (input.meltTempInletC - input.mouldTempC) * (1 - ratio);
  return {
    deltaTC: deltaT,
    outletTempC: input.meltTempInletC - deltaT,
    citation: cite('melt_temp_drop'),
  };
}

export function frozenLayerThicknessMm(alphaMm2PerS: number, fillTimeS: number): number {
  return 2 * Math.sqrt(Math.max(0, alphaMm2PerS * fillTimeS));
}
