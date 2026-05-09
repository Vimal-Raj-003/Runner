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
import { optimizeForFillBalance } from './runnerBalance';
import { computeYield, type YieldResult } from './yield';
import { DEFAULT_GATE_DROP_LEN_MM } from '../layouts/build';

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
  /**
   * Multi-objective weight λ in `loss = σ_fill + λ·σ_vol` for the auto-
   * balance solver. 0 = fill-only (legacy), 1 = balanced, ~3 = volume-priority.
   * Only used by the default-balanced step (3b) when no overrides exist.
   */
  balanceVolumeWeight?: number;
  /**
   * Optional gate location, in part-local mm. Coordinate frame:
   *   • Origin at part AABB centre on X and Z; AABB top (max Y) on Y.
   *   • Y is therefore ≤ 0 — depth into the part from its top surface.
   *   • Replicated to every cavity (same gate spec for every part copy).
   *
   * When set, every drop edge re-targets to land on this point: the drop's
   * gate junction shifts to (cavity.x + gx, runnerPlane, cavity.z + gz),
   * the drop length grows by |gy| so the drop bottom hits the picked
   * surface, and the upstream sub-runner length is recomputed because
   * the gate junction moved horizontally. When null, drops keep their
   * default top-centre AABB target (legacy behaviour).
   */
  gate?: { partLocalPoint: [number, number, number] };
  /**
   * When false, suppress the vertical gate drop: drop edge length is
   * forced to zero and the gate junction is co-located with the cavity
   * node. Used for layouts where the part is placed horizontally and the
   * runner plugs in directly at the gate point. Default true.
   */
  useGateDrop?: boolean;
  /**
   * If positive, post-process the generated tree so the minimum cavity-
   * to-cavity spacing is at least `max(partW, partD) + this margin`.
   * Larger parts therefore force the layout to scale up, preventing the
   * imported geometry from physically overlapping its neighbours or the
   * horizontal runner segments. 0 = no scaling.
   */
  partOverlapMarginMm?: number;
  /**
   * When true, rotate every part around its gate so the gate ends up on
   * the line between the cavity centre and the upstream junction. Each
   * cavity's gate-junction shifts by `r = √(gx² + gz²)` along that line
   * toward the parent — the sub-runner becomes straight and as short as
   * possible given the gate's part-local radial distance.
   *
   * Without this, every cavity gets the same `(gx, gz)` offset and the
   * sub-runners are diagonal V-shapes rather than straight lines.
   */
  autoMirrorGate?: boolean;
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

  // 1.5 — Auto-scale layout so the part doesn't physically overlap its
  // neighbours or the runner network. Only fires when the caller has
  // *explicitly* requested it via `partOverlapMarginMm > 0`; an absent
  // or zero margin preserves the legacy "let detectCavityOverlaps warn
  // the user" behaviour relied on by older tests and snapshot inputs.
  // When on, every node + cavity position is multiplied by a single
  // uniform factor so `min(cavity_to_cavity_dist) ≥ max(W, D) + margin`.
  // Edge lengths get recomputed from the scaled positions; drops keep
  // their lenMm (purely vertical, independent of XZ scale).
  const overlapMargin = input.partOverlapMarginMm ?? 0;
  const requiredSpacing =
    overlapMargin > 0
      ? Math.max(input.part.dimsMm.w, input.part.dimsMm.d) + overlapMargin
      : 0;
  if (requiredSpacing > 0 && tree.cavities.length > 1) {
    let minDist = Infinity;
    for (let i = 0; i < tree.cavities.length; i++) {
      for (let j = i + 1; j < tree.cavities.length; j++) {
        const a = tree.cavities[i]!;
        const b = tree.cavities[j]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > 0 && d < minDist) minDist = d;
      }
    }
    if (Number.isFinite(minDist) && minDist < requiredSpacing) {
      const scale = requiredSpacing / minDist;
      // Sprue stays at the origin so the layout's symmetry is preserved.
      for (const n of tree.nodes) {
        if (n.kind === 'sprue') continue;
        (n as { x: number; z: number }).x *= scale;
        (n as { x: number; z: number }).z *= scale;
      }
      for (const c of tree.cavities) {
        c.x *= scale;
        c.z *= scale;
      }
      // Recompute every non-drop edge length from its new endpoints —
      // drops carry their vertical extent in lenMm and aren't affected.
      const nodeById = new Map(tree.nodes.map((n) => [n.id, n] as const));
      for (const e of tree.edges) {
        if (e.isDrop) continue;
        const parent = nodeById.get(e.parentNodeId);
        const child = nodeById.get(e.childNodeId);
        if (!parent || !child) continue;
        const dx = child.x - parent.x;
        const dz = child.z - parent.z;
        e.lenMm = Math.sqrt(dx * dx + dz * dz);
      }
    }
  }

  // 2 — Pye base diameter
  const maxPath = Math.max(
    1,
    ...tree.cavities.map((c) => Math.sqrt(c.x * c.x + c.z * c.z)),
  );
  const pye = pyeRunnerDiameter({ partWeightG: input.part.weightG, runnerLengthMm: maxPath });
  const baseDia = pye.diameterMm;
  const recommendedDia = roundToStandardDiameter(baseDia);

  // 2.5 — Apply gate location, if the user picked one. Shifts every
  // gate junction (and its child cavity node) to (cavity.x + gx, _,
  // cavity.z + gz) on the runner plane, lengthens the drop by |gy| so
  // it terminates exactly at the picked surface point, and recomputes
  // the upstream sub-runner length because the gate junction moved.
  // Cavity *records* (used for overlap detection and part visualisation)
  // stay at their original positions — the part itself doesn't move,
  // only the runner endpoint into it does.
  // Drop suppression: when the user disables the gate drop, we apply
  // the same gate-junction shift logic as the with-drop case but force
  // the drop edge to zero length. The drop-only-from-sprue layouts also
  // collapse to zero length cleanly, since the 3D Euclidean recompute
  // below picks up dy = 0 in that branch.
  const dropEnabled = input.useGateDrop !== false; // undefined ⇒ enabled

  if (input.gate?.partLocalPoint || !dropEnabled) {
    const [gx, gy, gz] = input.gate?.partLocalPoint ?? [0, 0, 0];
    const r = Math.hypot(gx, gz);
    const autoMirror = input.autoMirrorGate === true;
    for (const cav of tree.cavities) {
      const cavityNode = tree.nodes.find(
        (n) => n.kind === 'cavity' && n.cavityId === cav.id,
      );
      if (!cavityNode) continue;
      const dropEdge = tree.edges.find(
        (e) => e.isDrop && e.childNodeId === cavityNode.id,
      );
      if (!dropEdge) continue;
      const dropParent = tree.nodes.find((n) => n.id === dropEdge.parentNodeId);

      // Per-cavity placement of the TWO drop endpoints:
      //
      //   • dropParent (gate junction) — top of the drop edge. With
      //     auto-mirror on, this sits at `cav + r·unit(upstream-cav)`,
      //     i.e. distance `r` from the cavity centre along the natural
      //     upstream→cavity direction. The sub-runner from upstream to
      //     gate_junction is then a straight extension of the layout's
      //     own runner line — for cardinal-axis layouts (H-Bridge,
      //     T-Runner, Inline) this puts the junction on a cardinal
      //     axis; for radial layouts it puts it along the radial spoke.
      //     Either way, no V-shape kink at the gate.
      //
      //   • cavityNode (gate orifice on the part) — bottom of the drop
      //     edge in xz, with the part rotated so it's axis-aligned. The
      //     part is rotated by `yRotSnapped` (rotation snapped to 90°)
      //     around its own centre, so the gate corner lands at
      //     `cav + R(yRotSnapped)·(gx, gz)`.
      //
      // The drop edge therefore SPANS two different xz positions — it's
      // the angled bridge between the straight runner and the rotated
      // part's gate corner. Drop length picks up that horizontal
      // displacement plus the vertical drop.
      //
      // Without auto-mirror (legacy uniform offset) both endpoints
      // collapse to `cav + (gx, gz)` and the drop is purely vertical,
      // matching the original behaviour.
      const gateAngleCW = Math.atan2(-gz, gx);
      let cavGx = gx;
      let cavGz = gz;
      let jxnGx = gx;
      let jxnGz = gz;
      if (autoMirror && r > 1e-3 && dropParent && dropParent.kind === 'junction') {
        const subRunnerEdge = tree.edges.find(
          (e) => !e.isDrop && e.childNodeId === dropParent.id,
        );
        const upstream = subRunnerEdge
          ? tree.nodes.find((n) => n.id === subRunnerEdge.parentNodeId)
          : null;
        if (upstream) {
          const dx = upstream.x - cav.x;
          const dz = upstream.z - cav.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 1e-3) {
            // Junction sits `r` along the unit upstream-direction. The
            // sub-runner becomes (upstream → junction) which is a perfect
            // straight extension of the layout's own runner line.
            const ux = dx / dist;
            const uz = dz / dist;
            jxnGx = ux * r;
            jxnGz = uz * r;

            // Part rotation snapped to 0/90/180/270° — keeps the part
            // axis-aligned even when the gate is at a corner, while
            // letting the drop bridge the gap from the straight runner.
            // Three.js Y rotation (right-handed):
            //   x' =  x·cos(θ) + z·sin(θ)
            //   z' = -x·sin(θ) + z·cos(θ)
            const dirToUpstreamCW = Math.atan2(-dz, dx);
            const quanta = Math.PI / 2;
            const desiredYRot = dirToUpstreamCW - gateAngleCW;
            const yRotSnapped = Math.round(desiredYRot / quanta) * quanta;
            const c = Math.cos(yRotSnapped);
            const s = Math.sin(yRotSnapped);
            cavGx =  gx * c + gz * s;
            cavGz = -gx * s + gz * c;
          }
        }
      }

      // Move the cavity node and its gate junction. The two endpoints
      // can now differ — the junction sits at the cardinal point on the
      // sub-runner, the cavity node sits at the rotated part's gate
      // corner, and the drop edge bridges them. RunnerNode.x/z are typed
      // readonly so we cast to widen — same trick used in geometry/override.ts.
      const cavM = cavityNode as { x: number; z: number };
      cavM.x = cav.x + cavGx;
      cavM.z = cav.z + cavGz;
      if (dropParent && dropParent.kind === 'junction') {
        const pM = dropParent as { x: number; z: number };
        pM.x = cav.x + jxnGx;
        pM.z = cav.z + jxnGz;
      }

      // Drop length: Manhattan = vertical + horizontal connector. The
      // viewer renders the drop as a real L-shape (straight vertical
      // tube + straight horizontal gate connector at part-top level),
      // so the flow path length is the SUM of the two legs, not the
      // diagonal. Drop suppression collapses the vertical component
      // to 0 but keeps the horizontal bridge.
      const verticalDrop = dropEnabled ? (DEFAULT_GATE_DROP_LEN_MM - gy) : 0;
      if (dropParent) {
        const dxBridge = cavityNode.x - dropParent.x;
        const dzBridge = cavityNode.z - dropParent.z;
        const horizontalBridge = Math.sqrt(dxBridge * dxBridge + dzBridge * dzBridge);
        dropEdge.lenMm = verticalDrop + horizontalBridge;
      }

      // Recompute the sub-runner length from the new gate-junction
      // position. With auto-mirror on this is |upstream-cavity| - r and
      // perfectly cardinal-aligned; without auto-mirror it's the
      // diagonal distance from upstream to the shifted gate junction.
      if (dropParent && dropParent.kind === 'junction') {
        const subRunnerEdge = tree.edges.find(
          (e) => !e.isDrop && e.childNodeId === dropParent.id,
        );
        if (subRunnerEdge) {
          const upstream = tree.nodes.find((n) => n.id === subRunnerEdge.parentNodeId);
          if (upstream) {
            const dx = dropParent.x - upstream.x;
            const dz = dropParent.z - upstream.z;
            subRunnerEdge.lenMm = Math.sqrt(dx * dx + dz * dz);
          }
        }
      }
    }
  }

  // 3 — Assign per-level diameters from recommendedDia and apply overrides.
  // Drop edges keep their layout-supplied default (typically 6 mm, set by
  // addCavityWithDrop) — they don't follow the depth-cascade, since their
  // role is the gate orifice, not a runner segment.
  for (const e of tree.edges) {
    if (e.isDrop) continue;
    e.diaMm = roundToStandardDiameter(recommendedDia * Math.pow(0.85, e.depth));
  }
  applyDiameterOverrides(tree.edges, input.overrides);
  applyLengthOverrides(tree, input.overrides);

  // 3b — Default-balanced state. When NO user overrides exist, run the
  // hydraulic balancer up-front so the runner system arrives at the
  // panel already tuned to equal cavity fill time. The solver writes
  // its result directly into tree.edges; downstream calculation steps
  // (pressure drop, balance metrics, fill time) then operate on the
  // already-balanced geometry.
  const overridesEmpty =
    Object.keys(input.overrides.diaByLevel ?? {}).length === 0 &&
    Object.keys(input.overrides.lenByLevel ?? {}).length === 0 &&
    Object.keys(input.overrides.diaByEdge  ?? {}).length === 0 &&
    Object.keys(input.overrides.lenByEdge  ?? {}).length === 0;
  if (overridesEmpty && tree.edges.length > 0) {
    const tempK = ((input.material.tMeltMin + input.material.tMeltMax) / 2) + 273.15;
    const eta0 = apparentViscosity(input.material, 1000, tempK);
    const cavVol0 = input.part.volumeMm3;
    const totalQ0 = (cavVol0 * input.cavities + 0) / 1; // sprue.volumeMm3 not yet computed; ok for relative split
    const balance = optimizeForFillBalance({
      tree,
      viscosityPaS: eta0,
      totalFlowMm3PerS: totalQ0,
      powerLawN: input.material.powerLaw?.n,
      cavityVolumeMm3: cavVol0,
      initialDiaByLevel: {},
      initialLenByLevel: {},
      lockedLevels: new Set(),
      volumeWeight: input.balanceVolumeWeight,
      // Skip length-rebuild — the panel-side rebuild callback isn't
      // available here, and diameter-only refinement is sufficient for
      // a default-balanced state. The user can run the full Balance
      // action manually if length-tuning is needed.
    });
    // Apply solver result directly to tree edges. Tunable levels are the
    // depth-based runner levels (L0, L1, …) PLUS gate drops (L_drop) — the
    // earlier filter `/^L\d+$/` silently dropped solver-suggested drop Ø
    // changes, leaving drops at their cascade default no matter what λ
    // (volume weight) the solver was running with.
    const tunableLevelRe = /^(L\d+|L_drop)$/;
    for (const e of tree.edges) {
      if (!tunableLevelRe.test(e.levelKey)) continue;
      const edgeDia = balance.diaByEdge[e.id];
      if (edgeDia !== undefined && edgeDia > 0) {
        e.diaMm = edgeDia;
        continue;
      }
      const levelDia = balance.diaByLevel[e.levelKey];
      if (levelDia !== undefined && levelDia > 0) {
        e.diaMm = levelDia;
      }
    }
  }

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
    // Drops sort *after* every depth-N level in the panel/tree summary.
    if (levelKey === 'L_drop') return 1000;
    return parseInt(levelKey.replace(/[^0-9]/g, ''), 10) || 0;
  }
}

// Profile factor is only used for yield adjustment; keep explicit imports warning-free
void RUNNER_PROFILES;
