/**
 * Reference material database — 20 grades covering every prototype
 * material group plus common engineering plastics.
 *
 * Numeric values compiled from:
 *   - CAMPUS Plastics Database (campusplastics.com) public summaries
 *   - Menges & Mohren, *How to Make Injection Molds* (1993), App. A
 *   - Rosato, *Injection Molding Handbook* (2000), App. B
 *   - Moldflow material database typical-grade ranges
 *
 * These are nominal values intended for pre-design sizing and should
 * be overridden by vendor-specific data for production work.
 */

import type { Material } from './schema';

export const MATERIAL_SEED: readonly Material[] = [
  // ── PE / PS (low viscosity) ──────────────────────────────────
  {
    id: 'pe-ldpe-generic',
    family: 'LDPE', grade: 'Film grade', group: 'PE_PS',
    rhoMelt: 780, rhoSolid: 920,
    tMeltMin: 160, tMeltMax: 260, tMouldMin: 20, tMouldMax: 60, tEject: 60,
    cp: 2300, lambda: 0.34,
    viscosityModel: 'power_law', powerLaw: { K: 2500, n: 0.45 },
    shearRateMax: 40000, shearStressMax: 0.17,
    gateConstantN: 0.6, source: 'literature',
    reference: 'Menges & Mohren 1993, App. A',
  },
  {
    id: 'pe-hdpe-generic',
    family: 'HDPE', grade: 'Injection grade', group: 'PE_PS',
    rhoMelt: 780, rhoSolid: 960,
    tMeltMin: 200, tMeltMax: 300, tMouldMin: 20, tMouldMax: 60, tEject: 80,
    cp: 2250, lambda: 0.44,
    viscosityModel: 'power_law', powerLaw: { K: 3200, n: 0.50 },
    shearRateMax: 40000, shearStressMax: 0.20,
    gateConstantN: 0.6, source: 'literature',
    reference: 'Menges & Mohren 1993, App. A',
  },
  {
    id: 'ps-gp',
    family: 'PS', grade: 'General-purpose (GPPS)', group: 'PE_PS',
    rhoMelt: 940, rhoSolid: 1050,
    tMeltMin: 180, tMeltMax: 260, tMouldMin: 20, tMouldMax: 70, tEject: 80,
    cp: 1340, lambda: 0.14,
    viscosityModel: 'power_law', powerLaw: { K: 3600, n: 0.30 },
    shearRateMax: 40000, shearStressMax: 0.30,
    gateConstantN: 0.6, source: 'literature',
    reference: 'Rosato 2000, App. B',
  },
  {
    id: 'ps-hips',
    family: 'HIPS', grade: 'High-impact', group: 'PE_PS',
    rhoMelt: 940, rhoSolid: 1040,
    tMeltMin: 200, tMeltMax: 280, tMouldMin: 20, tMouldMax: 70, tEject: 80,
    cp: 1340, lambda: 0.15,
    viscosityModel: 'power_law', powerLaw: { K: 4000, n: 0.28 },
    shearRateMax: 40000, shearStressMax: 0.30,
    gateConstantN: 0.6, source: 'literature',
    reference: 'Rosato 2000',
  },

  // ── POM / PC / PP (low–medium viscosity) ─────────────────────
  {
    id: 'pp-homo',
    family: 'PP', grade: 'Homopolymer', group: 'POM_PC_PP',
    rhoMelt: 760, rhoSolid: 905,
    tMeltMin: 200, tMeltMax: 280, tMouldMin: 30, tMouldMax: 80, tEject: 90,
    cp: 2100, lambda: 0.22,
    viscosityModel: 'power_law', powerLaw: { K: 4500, n: 0.35 },
    shearRateMax: 100000, shearStressMax: 0.25,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS typical PP grade',
  },
  {
    id: 'pp-copo',
    family: 'PP', grade: 'Copolymer', group: 'POM_PC_PP',
    rhoMelt: 760, rhoSolid: 900,
    tMeltMin: 200, tMeltMax: 280, tMouldMin: 30, tMouldMax: 80, tEject: 90,
    cp: 2000, lambda: 0.22,
    viscosityModel: 'power_law', powerLaw: { K: 4800, n: 0.33 },
    shearRateMax: 100000, shearStressMax: 0.25,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS',
  },
  {
    id: 'pc-generic',
    family: 'PC', grade: 'Optical', group: 'POM_PC_PP',
    rhoMelt: 1100, rhoSolid: 1200,
    tMeltMin: 280, tMeltMax: 320, tMouldMin: 80, tMouldMax: 120, tEject: 127,
    cp: 1260, lambda: 0.19,
    viscosityModel: 'power_law', powerLaw: { K: 12000, n: 0.70 },
    shearRateMax: 40000, shearStressMax: 0.50,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS typical PC grade',
  },
  {
    id: 'pom-homo',
    family: 'POM', grade: 'Homopolymer', group: 'POM_PC_PP',
    rhoMelt: 1250, rhoSolid: 1420,
    tMeltMin: 180, tMeltMax: 230, tMouldMin: 60, tMouldMax: 105, tEject: 130,
    cp: 1465, lambda: 0.31,
    viscosityModel: 'power_law', powerLaw: { K: 3000, n: 0.40 },
    shearRateMax: 40000, shearStressMax: 0.45,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS POM',
  },
  {
    id: 'pom-copo',
    family: 'POM', grade: 'Copolymer', group: 'POM_PC_PP',
    rhoMelt: 1250, rhoSolid: 1410,
    tMeltMin: 185, tMeltMax: 225, tMouldMin: 60, tMouldMax: 105, tEject: 130,
    cp: 1465, lambda: 0.31,
    viscosityModel: 'power_law', powerLaw: { K: 3200, n: 0.40 },
    shearRateMax: 40000, shearStressMax: 0.45,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS POM',
  },

  // ── CA / PMMA / Nylon (high viscosity) ───────────────────────
  {
    id: 'pmma-generic',
    family: 'PMMA', grade: 'Cast sheet grade', group: 'CA_PMMA_PA',
    rhoMelt: 1100, rhoSolid: 1180,
    tMeltMin: 220, tMeltMax: 280, tMouldMin: 40, tMouldMax: 90, tEject: 90,
    cp: 1470, lambda: 0.19,
    viscosityModel: 'power_law', powerLaw: { K: 8000, n: 0.25 },
    shearRateMax: 40000, shearStressMax: 0.40,
    gateConstantN: 0.8, source: 'literature',
    reference: 'CAMPUS PMMA',
  },
  {
    id: 'pa6-unfilled',
    family: 'PA6', grade: 'Unfilled', group: 'CA_PMMA_PA',
    rhoMelt: 970, rhoSolid: 1130,
    tMeltMin: 240, tMeltMax: 290, tMouldMin: 60, tMouldMax: 100, tEject: 190,
    cp: 1700, lambda: 0.25,
    viscosityModel: 'power_law', powerLaw: { K: 600, n: 0.55 },
    shearRateMax: 60000, shearStressMax: 0.50,
    gateConstantN: 0.8, source: 'literature',
    reference: 'CAMPUS PA6',
  },
  {
    id: 'pa66-unfilled',
    family: 'PA66', grade: 'Unfilled', group: 'CA_PMMA_PA',
    rhoMelt: 970, rhoSolid: 1140,
    tMeltMin: 270, tMeltMax: 320, tMouldMin: 70, tMouldMax: 110, tEject: 220,
    cp: 1700, lambda: 0.25,
    viscosityModel: 'power_law', powerLaw: { K: 700, n: 0.55 },
    shearRateMax: 60000, shearStressMax: 0.50,
    gateConstantN: 0.8, source: 'literature',
    reference: 'CAMPUS PA66',
  },
  {
    id: 'pa66-gf30',
    family: 'PA66', grade: 'GF30 (30% glass fibre)', group: 'CA_PMMA_PA',
    rhoMelt: 1180, rhoSolid: 1360,
    tMeltMin: 270, tMeltMax: 320, tMouldMin: 80, tMouldMax: 120, tEject: 230,
    cp: 1450, lambda: 0.30,
    viscosityModel: 'power_law', powerLaw: { K: 1200, n: 0.50 },
    shearRateMax: 60000, shearStressMax: 0.50,
    gateConstantN: 0.8, source: 'literature',
    reference: 'CAMPUS PA66-GF30',
  },
  {
    id: 'ca-generic',
    family: 'CA', grade: 'Cellulose Acetate', group: 'CA_PMMA_PA',
    rhoMelt: 1150, rhoSolid: 1310,
    tMeltMin: 170, tMeltMax: 230, tMouldMin: 40, tMouldMax: 70, tEject: 90,
    cp: 1500, lambda: 0.20,
    viscosityModel: 'power_law', powerLaw: { K: 7000, n: 0.30 },
    shearRateMax: 40000, shearStressMax: 0.35,
    gateConstantN: 0.8, source: 'literature',
    reference: 'Rosato 2000',
  },

  // ── PVC (high viscosity, shear-sensitive) ────────────────────
  {
    id: 'pvc-rigid',
    family: 'PVC', grade: 'Rigid (uPVC)', group: 'PVC',
    rhoMelt: 1250, rhoSolid: 1400,
    tMeltMin: 170, tMeltMax: 210, tMouldMin: 20, tMouldMax: 60, tEject: 70,
    cp: 1050, lambda: 0.16,
    viscosityModel: 'power_law', powerLaw: { K: 12000, n: 0.20 },
    shearRateMax: 20000, shearStressMax: 0.20,
    gateConstantN: 0.9, source: 'literature',
    reference: 'Menges & Mohren 1993',
  },
  {
    id: 'pvc-flex',
    family: 'PVC', grade: 'Flexible (plasticised)', group: 'PVC',
    rhoMelt: 1200, rhoSolid: 1300,
    tMeltMin: 160, tMeltMax: 200, tMouldMin: 20, tMouldMax: 50, tEject: 60,
    cp: 1250, lambda: 0.16,
    viscosityModel: 'power_law', powerLaw: { K: 8000, n: 0.25 },
    shearRateMax: 20000, shearStressMax: 0.20,
    gateConstantN: 0.9, source: 'literature',
    reference: 'Menges & Mohren 1993',
  },

  // ── Additional engineering staples ───────────────────────────
  {
    id: 'abs-generic',
    family: 'ABS', grade: 'General-purpose', group: 'POM_PC_PP',
    rhoMelt: 950, rhoSolid: 1050,
    tMeltMin: 220, tMeltMax: 270, tMouldMin: 40, tMouldMax: 80, tEject: 85,
    cp: 1470, lambda: 0.18,
    viscosityModel: 'power_law', powerLaw: { K: 7500, n: 0.30 },
    shearRateMax: 50000, shearStressMax: 0.30,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS ABS',
  },
  {
    id: 'pc-abs',
    family: 'PC/ABS', grade: 'Blend', group: 'POM_PC_PP',
    rhoMelt: 1070, rhoSolid: 1130,
    tMeltMin: 240, tMeltMax: 290, tMouldMin: 60, tMouldMax: 90, tEject: 110,
    cp: 1400, lambda: 0.20,
    viscosityModel: 'power_law', powerLaw: { K: 9000, n: 0.35 },
    shearRateMax: 40000, shearStressMax: 0.35,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS PC/ABS',
  },
  {
    id: 'pet-bottle',
    family: 'PET', grade: 'Bottle grade', group: 'POM_PC_PP',
    rhoMelt: 1200, rhoSolid: 1400,
    tMeltMin: 270, tMeltMax: 300, tMouldMin: 10, tMouldMax: 30, tEject: 100,
    cp: 1500, lambda: 0.29,
    viscosityModel: 'power_law', powerLaw: { K: 800, n: 0.65 },
    shearRateMax: 30000, shearStressMax: 0.25,
    gateConstantN: 0.7, source: 'literature',
    reference: 'CAMPUS PET',
  },
  {
    id: 'tpu-85a',
    family: 'TPU', grade: 'Shore 85A', group: 'CA_PMMA_PA',
    rhoMelt: 1120, rhoSolid: 1210,
    tMeltMin: 190, tMeltMax: 230, tMouldMin: 20, tMouldMax: 50, tEject: 60,
    cp: 1700, lambda: 0.19,
    viscosityModel: 'power_law', powerLaw: { K: 5500, n: 0.40 },
    shearRateMax: 30000, shearStressMax: 0.30,
    gateConstantN: 0.8, source: 'literature',
    reference: 'Menges & Mohren 1993',
  },
];

export function findMaterial(id: string): Material | undefined {
  return MATERIAL_SEED.find((m) => m.id === id);
}

export function materialsByGroup(group: string): readonly Material[] {
  return MATERIAL_SEED.filter((m) => m.group === group);
}
