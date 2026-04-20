/**
 * Central registry of engineering sources cited by the calculation core.
 * Every formula produces a `Citation` so that reports and UI can show
 * engineering provenance for each number.
 */

export interface Citation {
  readonly id: string;
  readonly formula: string;
  readonly source: string;
  readonly page?: string;
  readonly equation?: string;
  readonly note?: string;
}

export const CITATIONS = {
  pye_runner_dia: {
    id: 'pye_runner_dia',
    formula: 'D = ⁴√(W · L) / 3.7',
    source: 'Rosato, DiMattia & Rosato, Injection Molding Handbook (2000)',
    page: '§3.2',
    note: 'Original empirical correlation by Pye; valid for L < 150 mm, W < 20 cm²',
  },
  beaumont_gate_depth: {
    id: 'beaumont_gate_depth',
    formula: 'h = n · t',
    source: 'Beaumont, Mould Design (1974)',
    page: 'p.87',
    note: 'Material constant n = 0.6–0.9 by viscosity group',
  },
  beaumont_gate_width: {
    id: 'beaumont_gate_width',
    formula: 'W = n · √A / 30',
    source: 'Beaumont, Mould Design (1974) / Rosato §5.4',
    note: 'A = projected cavity surface area in mm²',
  },
  dme_sprue_taper: {
    id: 'dme_sprue_taper',
    formula: 'taper = 2° incl., orifice = nozzle + 0.75 mm',
    source: 'DME / HASCO sprue-bush catalogues',
    note: '1.5–3° range; 2° is the de-facto production standard',
  },
  clamp_force_simple: {
    id: 'clamp_force_simple',
    formula: 'F [t] = (A_proj · P_inj) / 10000',
    source: 'Rees, Mold Engineering 2e (2002)',
    page: '§4',
    note: 'Simplified; neglects side-action and core-lift forces',
  },
  hagen_poiseuille: {
    id: 'hagen_poiseuille',
    formula: 'ΔP = 128 η Q L / (π r⁴)',
    source: 'Bird, Stewart, Lightfoot, Transport Phenomena (1960); Menges & Mohren (1993)',
    note: 'Newtonian, laminar, isothermal; correct with power-law factor for polymers',
  },
  power_law_correction: {
    id: 'power_law_correction',
    formula: 'ΔP′ = ΔP · n / (3 n + 1)',
    source: 'Menges & Mohren, How to Make Injection Molds (1993)',
    note: 'Shear-thinning correction; n is the power-law exponent (typ. 0.25–0.6)',
  },
  apparent_shear_rate_round: {
    id: 'apparent_shear_rate_round',
    formula: 'γ̇ = 4 Q / (π r³)',
    source: 'Rees, Mold Engineering 2e (2002)',
    page: '§4.3',
    note: 'Apparent wall shear rate for round channel',
  },
  apparent_shear_rate_rect: {
    id: 'apparent_shear_rate_rect',
    formula: 'γ̇ = 6 Q / (W · h²)',
    source: 'Rees, Mold Engineering 2e (2002)',
    page: '§4.3',
    note: 'Apparent wall shear rate for rectangular gate',
  },
  shear_stress: {
    id: 'shear_stress',
    formula: 'τ = η · γ̇',
    source: 'Menges & Mohren (1993)',
    note: 'τ_max limit prevents thermomechanical degradation / silver streak',
  },
  melt_temp_drop: {
    id: 'melt_temp_drop',
    formula: 'ΔT = (T₀ − T_w) · exp(−h · A / (ṁ · cp))',
    source: 'Menges & Ballman, Thermal Aspects of Plastic Processing (1986)',
    equation: 'eq. 2.14',
    note: 'Lumped heat-transfer model along the runner',
  },
  menges_freeze_time: {
    id: 'menges_freeze_time',
    formula: 't_c = s² / (π² α) · ln[(4/π)(T_m − T_w) / (T_e − T_w)]',
    source: 'Menges & Ballman (1986)',
    note: 'Classical cooling-time formula for a plate of thickness s',
  },
  fill_time: {
    id: 'fill_time',
    formula: 't_fill = V / (ρ · v_gate)',
    source: 'Rees (2002)',
    note: 'v_gate ≈ √(2 ΔP / ρ) — simplified orifice velocity',
  },
  runner_balance: {
    id: 'runner_balance',
    formula: 'σ(L/D)/mean(L/D) < 0.10 ⇒ balanced',
    source: 'Beaumont, Runner and Gating Design Handbook (2007)',
    note: 'Artificial layouts may require gate-restriction balancing',
  },
  shot_weight_yield: {
    id: 'shot_weight_yield',
    formula: 'W_shot = ρ_melt · (V_cav · N + V_runner);  yield = (V_cav · N) / (V_cav · N + V_runner)',
    source: 'Rosato et al. (2000)',
    page: '§7.2',
  },
  frozen_layer: {
    id: 'frozen_layer',
    formula: 'δ_frozen ≈ 2 · √(α · t_fill)',
    source: 'Menges & Mohren (1993)',
    page: '§3.4',
  },
  runner_profile_efficiency: {
    id: 'runner_profile_efficiency',
    formula: 'η_runner = A / P (volume-to-surface ratio)',
    source: 'Rosato et al. (2000), §3.2',
    note: 'Higher ratio = less heat loss, preferred for thin-section parts',
  },
  nayak_runner_dia_table: {
    id: 'nayak_runner_dia_table',
    formula: 'D [mm]  →  L_max [mm]  (per viscosity class)',
    source: 'Nayak & Rao, Handbook of Injection Molding (2012)',
    page: 'Table 2.12',
  },
} as const satisfies Record<string, Citation>;

export type CitationId = keyof typeof CITATIONS;

export function cite(id: CitationId): Citation {
  return CITATIONS[id];
}
