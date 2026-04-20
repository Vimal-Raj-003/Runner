/**
 * Top-level calculation pipeline — the authoritative entry point for
 * every design action. Pure function: identical input always produces
 * identical output. Called both client-side (for instant preview) and
 * server-side (for the audit snapshot).
 */

import type { Citation } from '../citations';
import type { Material } from '../materials/schema';
import { apparentViscosity, thermalDiffusivity } from '../materials/schema';
import type { RunnerProfile } from '../profiles';
import { RUNNER_PROFILES } from '../profiles';
import type { LayoutId } from '../layouts/types';
import { getLayout } from '../layouts/index';
import type { RunnerEdge, RunnerTree } from '../geometry/tree';
import {
  applyDiameterOverrides,
  applyLengthOverrides,
  type Overrides,
} from '../geometry/override';
import { detectCavityOverlaps, type CavityOverlap } from '../geometry/overlap';
import { pyeRunnerDiameter, roundToStandardDiameter } from './pye';
import { computeGate, type GateResult } from './gate';
import { computeSprue, type SprueResult } from './sprue';
import { computeClampForce, type ClampResult } from './clamp';
import { treePressureDrop, type TreePressureDropResult } from './pressureDrop';
import {
  roundChannelShear,
  rectGateShear,
  assessShearSafety,
  type ShearResult,
  type ShearSafety,
} from './shear';
import {
  computeFillTime,
  computeFreezeTime,
  computeMeltTempDrop,
  frozenLayerThicknessMm,
  type FillTimeResult,
  type FreezeTimeResult,
  type MeltTempDropResult,
} from './thermal';
import { analyseBalance, type BalanceResult } from './balance';
import { computeYield, type YieldResult } from './yield';

export interface MachineInput {
  nozzleDiaMm: number;
  injectionPressureBar: number;
  clampForceTonne: number;
  sprueLengthMm?: number;   // default 80 mm
}

export interface PartInput {
  weightG: number;             // per cavity
  volumeMm3: number;           // per cavity
  wallThicknessMm: number;
  projectedAreaMm2: number;    // per cavity
  dimsMm: { w: number; d: number; h: number };
}

export interface CalcInput {
  part: PartInput;
  cavities: number;
  gatesPerCavity: 1 | 2;
  layoutId: LayoutId;
  profile: RunnerProfile;
  hotRunner: boolean;
  material: Material;
  machine: MachineInput;
  overrides: Overrides;
  /** Optional explicit gate geometry override (else computed from Beaumont) */
  gateGeometry?: { widthMm: number; depthMm: number };
}

export interface LevelResult {
  levelKey: string;
  levelName: string;
  diaMm: number;
  lengthMm: number;
  count: number;
  volumeMm3: number;
  shear: ShearResult;
  shearSafety: ShearSafety;
}

export interface Warning {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  citations?: readonly Citation[];
}

export interface CalcResult {
  input: CalcInput;
  tree: RunnerTree;

  runner: {
    baseDiaMm: number;                      // Pye recommendation
    recommendedDiaMm: number;               // rounded to 0.5 mm steps
    maxPathLengthMm: number;
    totalVolumeMm3: number;
    totalWeightG: number;
    levels: LevelResult[];
    pressureDrop: TreePressureDropResult;
  };
  gate: GateResult & { shear: ShearResult; shearSafety: ShearSafety };
  sprue: SprueResult;
  mechanical: {
    clamp: ClampResult;
    clampUtilisationPct: number;
    machinePressureUtilisationPct: number;
  };
  thermal: {
    fill: FillTimeResult;
    freeze: FreezeTimeResult;
    meltDrop: MeltTempDropResult;
    frozenLayerMm: number;
  };
  balance: BalanceResult;
  yield: YieldResult;
  overlaps: CavityOverlap[];
  warnings: Warning[];
  citations: readonly Citation[];
  calcVersion: string;
}

export const CALC_VERSION = '0.1.0';

export function runCalculations(input: CalcInput): CalcResult {
  // 1 — Build topology (pure, via layout generator)
  const generator = getLayout(input.layoutId);
  const tree = generator.generate(input.cavities);

  // 2 — Pye base diameter
  const maxPath = Math.max(
    1,
    ...tree.cavities.map((c) => Math.sqrt(c.x * c.x + c.z * c.z)),
  );
  const pye = pyeRunnerDiameter({ partWeightG: input.part.weightG, runnerLengthMm: maxPath });
  const baseDia = pye.diameterMm;
  const recommendedDia = roundToStandardDiameter(baseDia);

  // 3 — Assign per-level diameters from recommendedDia and apply overrides
  for (const e of tree.edges) {
    e.diaMm = roundToStandardDiameter(recommendedDia * Math.pow(0.85, e.depth));
  }
  applyDiameterOverrides(tree.edges, input.overrides);
  applyLengthOverrides(tree, input.overrides);

  // 4 — Gate sizing (Beaumont) — fallback to override if supplied
  const gate = computeGate({
    wallThicknessMm: input.part.wallThicknessMm,
    projectedAreaMm2: input.part.projectedAreaMm2,
    material: input.material,
  });
  const gateW = input.gateGeometry?.widthMm ?? gate.widthMm;
  const gateH = input.gateGeometry?.depthMm ?? gate.depthMm;

  // 5 — Sprue
  const sprueLen = input.machine.sprueLengthMm ?? 80;
  const sprue = computeSprue({ nozzleDiaMm: input.machine.nozzleDiaMm, sprueLengthMm: sprueLen });

  // 6 — Rheology @ nominal shear rate 1000 s⁻¹, nominal processing temp
  const processingTempK = ((input.material.tMeltMin + input.material.tMeltMax) / 2) + 273.15;
  const eta = apparentViscosity(input.material, 1000, processingTempK);
  const powerLawN = input.material.powerLaw?.n;

  // 7 — Volumetric flow estimate: shot mass / fill time heuristic
  const cavVol = input.part.volumeMm3;
  const shotVolGross = cavVol * input.cavities + sprue.volumeMm3;
  const assumedFillTimeS = 1; // initial assumption; refined below
  const totalQ = shotVolGross / Math.max(0.1, assumedFillTimeS);

  // 8 — Pressure drop through tree
  const pressure = treePressureDrop({
    tree,
    viscosityPaS: eta,
    totalFlowMm3PerS: totalQ,
    powerLawN,
  });

  // 9 — Gate shear
  const gateQ = totalQ / Math.max(1, input.cavities * input.gatesPerCavity);
  const gateShear = rectGateShear(gateQ, gateW, gateH, eta);
  const gateSafety = assessShearSafety(
    gateShear,
    input.material.shearRateMax,
    input.material.shearStressMax,
  );

  // 10 — Per-level aggregation
  const levels: LevelResult[] = [];
  const levelMap = new Map<string, RunnerEdge[]>();
  for (const e of tree.edges) {
    const arr = levelMap.get(e.levelKey) ?? [];
    arr.push(e);
    levelMap.set(e.levelKey, arr);
  }
  for (const [key, edges] of [...levelMap].sort((a, b) => parseDepth(a[0]) - parseDepth(b[0]))) {
    const rep = edges.reduce((best, e) => (e.lenMm > best.lenMm ? e : best), edges[0]!);
    const count = edges.length;
    const avgDia = edges.reduce((a, e) => a + e.diaMm, 0) / count;
    const totalLen = edges.reduce((a, e) => a + e.lenMm, 0);
    const vol = edges.reduce((a, e) => {
      const r = e.diaMm / 2;
      return a + Math.PI * r * r * e.lenMm;
    }, 0);
    const levelShear = roundChannelShear(totalQ / count, avgDia, eta);
    const levelSafety = assessShearSafety(
      levelShear,
      input.material.shearRateMax,
      input.material.shearStressMax,
    );
    levels.push({
      levelKey: key,
      levelName: rep.levelName,
      diaMm: avgDia,
      lengthMm: totalLen,
      count,
      volumeMm3: vol,
      shear: levelShear,
      shearSafety: levelSafety,
    });
  }

  // 11 — Clamp force
  const projAreaTotal =
    (input.part.projectedAreaMm2 * input.cavities) +
    tree.edges.reduce((a, e) => a + e.diaMm * e.lenMm, 0); // rough runner projection
  const clamp = computeClampForce({
    projectedAreaMm2: projAreaTotal,
    injectionPressureBar: input.machine.injectionPressureBar,
  });

  // 12 — Thermal
  const fill = computeFillTime({
    cavityVolumeMm3: cavVol,
    deltaPMPa: Math.max(10, pressure.worstPathMPa || 10),
    meltDensityKgM3: input.material.rhoMelt,
  });
  const freeze = computeFreezeTime({
    wallThicknessMm: input.part.wallThicknessMm,
    meltTempC: (input.material.tMeltMin + input.material.tMeltMax) / 2,
    mouldTempC: (input.material.tMouldMin + input.material.tMouldMax) / 2,
    ejectionTempC: input.material.tEject,
    material: input.material,
  });
  const surfaceArea = tree.edges.reduce((a, e) => a + Math.PI * e.diaMm * e.lenMm, 0);
  const massFlow = (input.material.rhoMelt * totalQ * 1e-9);
  const meltDrop = computeMeltTempDrop({
    meltTempInletC: (input.material.tMeltMin + input.material.tMeltMax) / 2,
    mouldTempC: (input.material.tMouldMin + input.material.tMouldMax) / 2,
    runnerSurfaceAreaMm2: surfaceArea,
    massFlowKgPerS: massFlow,
    material: input.material,
  });
  const frozenLayer = frozenLayerThicknessMm(thermalDiffusivity(input.material), fill.fillTimeS);

  // 13 — Yield & balance
  const yieldR = computeYield({
    tree,
    cavityVolumeMm3: cavVol,
    sprueVolumeMm3: sprue.volumeMm3,
    profile: input.profile,
    meltDensityKgM3: input.material.rhoMelt,
    hotRunner: input.hotRunner,
  });
  const balance = analyseBalance(tree);

  // 14 — Overlaps
  const overlaps = detectCavityOverlaps(
    tree.cavities,
    input.part.dimsMm.w,
    input.part.dimsMm.d,
  );

  // 15 — Warnings & citation roll-up
  const warnings: Warning[] = [];
  if (!gateSafety.withinShearRate) {
    warnings.push({
      severity: 'warn',
      code: 'gate_shear_rate_exceeded',
      message: `Gate shear rate ${gateShear.shearRateS.toFixed(0)} s⁻¹ exceeds ${input.material.shearRateMax} s⁻¹ limit for ${input.material.family}`,
      citations: [gateShear.citations.rate],
    });
  }
  if (!gateSafety.withinShearStress) {
    warnings.push({
      severity: 'warn',
      code: 'gate_shear_stress_exceeded',
      message: `Gate shear stress ${gateShear.shearStressMPa.toFixed(2)} MPa exceeds ${input.material.shearStressMax} MPa limit`,
      citations: [gateShear.citations.stress],
    });
  }
  if (pressure.worstPathMPa > input.machine.injectionPressureBar / 10) {
    warnings.push({
      severity: 'error',
      code: 'insufficient_machine_pressure',
      message: `Worst-path ΔP ${pressure.worstPathMPa.toFixed(1)} MPa exceeds machine capability ${(input.machine.injectionPressureBar / 10).toFixed(1)} MPa`,
      citations: [pressure.citations.hagen],
    });
  }
  if (clamp.clampForceTonne > input.machine.clampForceTonne) {
    warnings.push({
      severity: 'error',
      code: 'insufficient_clamp_force',
      message: `Required clamp ${clamp.clampForceTonne.toFixed(0)} t exceeds machine ${input.machine.clampForceTonne} t`,
      citations: [clamp.citation],
    });
  }
  if (!balance.isBalanced) {
    warnings.push({
      severity: 'warn',
      code: 'layout_unbalanced',
      message: `Imbalance ratio ${(balance.imbalanceRatio * 100).toFixed(1)}% > 10%; consider diameter tuning or balanced layout`,
      citations: [balance.citation],
    });
  }
  if (overlaps.length > 0) {
    warnings.push({
      severity: 'error',
      code: 'cavity_overlap',
      message: `${overlaps.length} cavity overlap${overlaps.length > 1 ? 's' : ''} detected — increase cavity spacing or reduce part footprint`,
    });
  }

  const citations: Citation[] = Array.from(new Map([
    ...[pye.citation, gate.citations.depth, gate.citations.width, sprue.citation, clamp.citation,
       pressure.citations.hagen, pressure.citations.powerLaw, gateShear.citations.rate,
       gateShear.citations.stress, fill.citation, freeze.citation, meltDrop.citation,
       balance.citation, yieldR.citation].map((c) => [c.id, c] as const),
  ]).values());

  const totalWeightG = (input.material.rhoMelt *
    tree.edges.reduce((a, e) => {
      const r = e.diaMm / 2;
      return a + Math.PI * r * r * e.lenMm;
    }, 0) * 1e-9) * 1000;

  return {
    input,
    tree,
    runner: {
      baseDiaMm: baseDia,
      recommendedDiaMm: recommendedDia,
      maxPathLengthMm: maxPath,
      totalVolumeMm3: yieldR.runnerVolumeMm3,
      totalWeightG,
      levels,
      pressureDrop: pressure,
    },
    gate: { ...gate, shear: gateShear, shearSafety: gateSafety },
    sprue,
    mechanical: {
      clamp,
      clampUtilisationPct:
        input.machine.clampForceTonne > 0
          ? (clamp.clampForceTonne / input.machine.clampForceTonne) * 100
          : 0,
      machinePressureUtilisationPct:
        input.machine.injectionPressureBar > 0
          ? (pressure.worstPathMPa * 10 / input.machine.injectionPressureBar) * 100
          : 0,
    },
    thermal: { fill, freeze, meltDrop, frozenLayerMm: frozenLayer },
    balance,
    yield: yieldR,
    overlaps,
    warnings,
    citations,
    calcVersion: CALC_VERSION,
  };

  function parseDepth(levelKey: string): number {
    return parseInt(levelKey.replace(/[^0-9]/g, ''), 10) || 0;
  }
}

// Profile factor is only used for yield adjustment; keep explicit imports warning-free
void RUNNER_PROFILES;
