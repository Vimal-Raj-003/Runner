/**
 * Runner balancing analyser.
 *
 * Goal: equal fill time across every sprue → cavity path. Imbalance is
 * defined as σ(t_fill) / mean(t_fill) and the production-grade target is
 * < 2 % (Beaumont 2007 §5 — for high-precision parts).
 *
 * Pipeline
 *   1. CASCADE — apply industry sizing ratios to every non-locked level:
 *        D_sub    = D_main   × 0.85
 *        D_branch = D_sub    × 0.80
 *        D_gate   = D_branch × 0.50      (drop / gate)
 *      The user's locked Ø values seed the cascade. Levels with no anchor
 *      keep their current Ø.
 *   2. CLAMP — keep diameters in the manufacturable [2 mm, 20 mm] window.
 *      If the cascade pushes a level below 2 mm the algorithm clamps and
 *      sets a flag that triggers length re-balancing in step 3.
 *   3. REFINE — a hand-rolled damped-gradient ("Newton-style") solver that
 *      tweaks each non-locked dimension by central finite differences and
 *      backtracks the step until σ improves. Stops when σ < 2 % or after
 *      MAX_ITER iterations.
 *
 * Sources
 *   • Pye, *Injection Mould Design* (1971) — sizing ratios.
 *   • Beaumont, *Runner and Gating Design Handbook* (2007) §5 — target σ.
 *   • Menges & Mohren, *How to Make Injection Molds* (1993) — Hagen-Poiseuille.
 */

import type { RunnerTree } from '../geometry/tree';
import { computeEdgeClasses } from '../geometry/edgeClasses';
import { computeFillBalance, type FillBalanceResult } from './fillTime';

// Cascade ratios (Pye 1971 conventions). Tuned for cold runners; hot
// runners typically use a flatter profile, but that's deferred.
const CASCADE_RATIO: Record<number, number> = {
  // depth → ratio of THIS level relative to its parent
  0: 1.0,    // main runner — anchor
  1: 0.85,   // sub runner
  2: 0.80,   // branch runner
  3: 0.50,   // gate (rare in this UI; kept for future)
};

const D_MIN_MM = 2.0;
const D_MAX_MM = 13.0;       // Pye industry standard upper bound
const STD_STEP_MM = 0.5;

/**
 * Width of the search window the solver explores around each class's
 * cascade-default. Going too wide lets the solver find degenerate "max
 * main / min sub" solutions that minimise σ by making everything
 * upstream negligible — technically balanced but engineering-wasteful.
 * The window is asymmetric: more upward flexibility than downward, since
 * outer-section diameters need to grow to compensate for path resistance.
 */
const SEARCH_DOWN_STEPS = 2;   // up to 2 std-steps (= 1.0 mm) below the seed
const SEARCH_UP_STEPS   = 6;   // up to 6 std-steps (= 3.0 mm) above the seed

/**
 * Penalty added to σ per mm of deviation from the cascade default. Tiny
 * so it doesn't prevent real improvements, but enough to break ties in
 * favour of textbook-near sizing (≈ 1 % σ per mm).
 */
const CASCADE_BIAS_PER_MM = 0.01;

/** Standard runner-drill set, half-mm steps in [D_MIN_MM, D_MAX_MM]. */
const STD_DIAMETERS_MM: readonly number[] = (() => {
  const out: number[] = [];
  for (let d = D_MIN_MM; d <= D_MAX_MM; d += STD_STEP_MM) out.push(Math.round(d * 10) / 10);
  return out;
})();

/** Returns the standard-diameter values within ±window of `seed`. */
function candidatesAround(seed: number): number[] {
  const lo = Math.max(D_MIN_MM, seed - SEARCH_DOWN_STEPS * STD_STEP_MM);
  const hi = Math.min(D_MAX_MM, seed + SEARCH_UP_STEPS * STD_STEP_MM);
  return STD_DIAMETERS_MM.filter((d) => d >= lo && d <= hi);
}

const DEFAULT_TARGET_SIGMA = 0.02;
const DEFAULT_MAX_ITER = 100;
const FD_STEP_MM = 0.25;        // finite-difference perturbation (Ø)
const FD_LEN_STEP_MM = 2;       // finite-difference perturbation (L)
const ALPHA_INITIAL = 1.0;
const ALPHA_MIN = 1 / 32;
const ALPHA_BACKTRACK = 0.5;

const depthRe = /^L(\d+)$/;

/** Levels the solver is allowed to tune — depth-based runner levels plus drops. */
const isTunableLevelKey = (key: string): boolean =>
  depthRe.test(key) || key === 'L_drop';

export interface RunnerBalanceInputs {
  tree: RunnerTree;
  viscosityPaS: number;
  totalFlowMm3PerS: number;
  powerLawN?: number;
  cavityVolumeMm3: number;
  /** Current diameter overrides keyed by levelKey. */
  initialDiaByLevel: Record<string, number>;
  /** Current per-edge length overrides keyed by levelKey. */
  initialLenByLevel: Record<string, number>;
  /** Levels (e.g. "L0", "L1") whose Ø + L the solver MUST NOT touch. */
  lockedLevels: ReadonlySet<string>;
  /** Default 0.02 (production-grade ±2 %). */
  targetSigma?: number;
  maxIterations?: number;
  /** Reserved: rebuild the tree with new length overrides (for length re-balance). */
  rebuildWithLenOverrides?: (lenByLevel: Record<string, number>) => RunnerTree;
  /**
   * Multi-objective weight for runner-volume imbalance, λ.
   *   loss = σ_fill + λ · σ_vol + cascade-bias
   * Default 0 (legacy behaviour: minimise fill σ only). λ = 1 gives the
   * solver an incentive to push outer-path Ø *down* so per-cavity runner
   * volume converges, while drops compensate to keep fill σ low. Useful
   * for chain Fishbone / Inline / T-Runner where fill alone leaves a big
   * volume imbalance. Larger λ makes the trade-off more aggressive.
   */
  volumeWeight?: number;
}

export interface RunnerBalanceResult {
  ok: boolean;
  /** Suggested per-level Ø — every depth level present in the tree. */
  diaByLevel: Record<string, number>;
  /** Suggested per-edge L — only for levels that the solver actually changed. */
  lenByLevel: Record<string, number>;
  /**
   * Per-edge Ø tuning. Populated when the level-only solver can't reach
   * the target σ — i.e. for asymmetric layouts where different edges in
   * the same level need different diameters. When non-empty, takes
   * precedence over diaByLevel.
   */
  diaByEdge: Record<number, number>;
  /** σ(t_fill) / mean(t_fill) at the final solution. */
  finalSigma: number;
  /** Per-cavity fill times etc. at the final solution. */
  fillTimes: FillBalanceResult;
  /** Actual iteration count consumed. */
  iterations: number;
  converged: boolean;
  reason?: 'all-locked' | 'no-free-depth-levels' | 'did-not-converge';
  /** True when the cascade hit the manufacturability floor on at least one level. */
  hitFloorClamp: boolean;
  /** True when the solver had to use per-edge tuning to reach (or approach) target. */
  usedEdgeTuning: boolean;
}

const snapToStd = (d: number): number =>
  Math.max(D_MIN_MM, Math.min(D_MAX_MM, Math.round(d / STD_STEP_MM) * STD_STEP_MM));

export function optimizeForFillBalance(args: RunnerBalanceInputs): RunnerBalanceResult {
  const target = args.targetSigma ?? DEFAULT_TARGET_SIGMA;
  const maxIter = args.maxIterations ?? DEFAULT_MAX_ITER;

  const allDepthLevels = Array.from(
    new Set(args.tree.edges.map((e) => e.levelKey).filter(isTunableLevelKey)),
  ).sort((a, b) => parseDepth(a) - parseDepth(b));

  if (allDepthLevels.length === 0) {
    return emptyResult(args, 'no-free-depth-levels', false);
  }
  const free = allDepthLevels.filter((k) => !args.lockedLevels.has(k));
  if (free.length === 0) {
    return emptyResult(args, 'all-locked', false);
  }

  // Seed working dia/len from the user's overrides + the tree's defaults.
  const dia: Record<string, number> = { ...args.initialDiaByLevel };
  const len: Record<string, number> = { ...args.initialLenByLevel };
  const perEdgeDia = perEdgeDiameterByLevel(args.tree);
  const perEdgeLen = perEdgeLengthByLevel(args.tree);
  for (const k of allDepthLevels) {
    if (dia[k] === undefined) dia[k] = perEdgeDia.get(k) ?? D_MIN_MM;
    if (len[k] === undefined) len[k] = perEdgeLen.get(k) ?? 0;
  }

  // STEP 1+2 — cascade from the shallowest locked level (or, if none locked,
  // from the user's most recent override which we proxy by treating the
  // shallowest depth as anchor). Levels deeper than the anchor adopt the
  // industry ratio; their initial value becomes the seed for the refinement.
  const anchorDepth = computeAnchorDepth(allDepthLevels, args.lockedLevels);
  const anchorKey = `L${anchorDepth}`;
  const anchorDia = dia[anchorKey] ?? D_MIN_MM;
  let hitFloor = false;
  for (const k of allDepthLevels) {
    if (args.lockedLevels.has(k)) continue;
    // Drop edges keep their seeded value (typically 6 mm) — they don't
    // follow the depth cascade since they're orifices, not runner segments.
    if (k === 'L_drop') continue;
    const d = parseDepth(k);
    if (d <= anchorDepth) continue;
    let cascaded = anchorDia;
    for (let dd = anchorDepth + 1; dd <= d; dd++) {
      cascaded *= CASCADE_RATIO[dd] ?? 0.85;
    }
    if (cascaded < D_MIN_MM) {
      cascaded = D_MIN_MM;
      hitFloor = true;
    }
    dia[k] = snapToStd(cascaded);
  }

  // STEP 3 — damped finite-difference refinement.
  const lenChanged: Record<string, number> = {};
  let currentTree = args.tree;
  let iterations = 0;

  // Multi-objective loss = σ_fill + λ·σ_vol. λ = 0 reproduces the legacy
  // fill-only behaviour. λ > 0 lets the solver trade a small fill σ for a
  // big drop in volume σ — the typical case for chain layouts where the
  // outer paths are geometrically longer than the inner ones.
  const lambda = Math.max(0, args.volumeWeight ?? 0);

  const evalLoss = (
    diaCandidate: Record<string, number>,
    lenCandidate: Record<string, number> | null,
    treeRef: RunnerTree,
  ): { fill: number; vol: number; loss: number } => {
    iterations++;
    const treeUsed =
      lenCandidate && args.rebuildWithLenOverrides
        ? args.rebuildWithLenOverrides(lenCandidate)
        : treeRef;
    const edgesPatched = treeUsed.edges.map((e) => {
      if (isTunableLevelKey(e.levelKey) && diaCandidate[e.levelKey] !== undefined) {
        return { ...e, diaMm: diaCandidate[e.levelKey]! };
      }
      return e;
    });
    const ft = computeFillBalance({
      tree: { ...treeUsed, edges: edgesPatched },
      viscosityPaS: args.viscosityPaS,
      totalFlowMm3PerS: args.totalFlowMm3PerS,
      powerLawN: args.powerLawN,
      cavityVolumeMm3: args.cavityVolumeMm3,
    });
    return {
      fill: ft.imbalanceRatio,
      vol: ft.volumeImbalanceRatio,
      loss: ft.imbalanceRatio + lambda * ft.volumeImbalanceRatio,
    };
  };

  let initial = evalLoss(dia, null, currentTree);
  let bestSigma = initial.fill;
  let bestLoss = initial.loss;

  // Skip level-mode whenever nothing is locked OR whenever λ > 0. Class-
  // mode (Step 4) is a strict superset — it can produce identical results
  // for natural-balance layouts and per-section results for asymmetric
  // ones, without the pathological "expand L0 uniformly until sub
  // dominates" trap that level-mode falls into.
  //
  // The λ > 0 case is critical: with the multi-objective loss, level-mode
  // tends to collapse all sub edges to a uniform very small Ø (which
  // minimises fill σ at the cost of huge resistance and locks the seed
  // for class-mode at the floor). Going straight to class-mode preserves
  // each section's seed at the cascade default and lets phased descent
  // differentiate Section 1 from Section 2.
  const skipLevelMode = args.lockedLevels.size === 0 || lambda > 0;

  // When λ > 0 we keep optimising even after fill σ < target — there may
  // still be volume σ to squeeze out. Inner `improvedThisStep` check
  // guarantees termination once descent stops.
  const earlyStopOnFillTarget = lambda === 0;

  for (
    let it = 0;
    !skipLevelMode && it < maxIter && (!earlyStopOnFillTarget || bestSigma > target);
    it++
  ) {
    let improvedThisStep = false;

    // Diameter pass — coordinate descent within ±window of the cascade
    // seed, biased toward keeping diameters near the cascade default to
    // avoid degenerate "max main" trivial solutions.
    for (const lvl of free) {
      const cur = dia[lvl]!;
      const seed = cur;
      let bestVal = cur;
      let localBest = bestLoss + CASCADE_BIAS_PER_MM * Math.abs(cur - seed);
      for (const candidate of candidatesAround(seed)) {
        if (candidate === cur) continue;
        const trial = { ...dia, [lvl]: candidate };
        const result = evalLoss(trial, null, currentTree);
        const score = result.loss + CASCADE_BIAS_PER_MM * Math.abs(candidate - seed);
        if (score < localBest - 1e-6) {
          localBest = score;
          bestVal = candidate;
        }
      }
      if (bestVal !== cur) {
        dia[lvl] = bestVal;
        const result = evalLoss(dia, null, currentTree);
        bestSigma = result.fill;
        bestLoss = result.loss;
        improvedThisStep = true;
      }
    }

    // Length pass — only if Ø-only stalled AND a rebuild callback exists.
    if (!improvedThisStep && bestSigma > target && args.rebuildWithLenOverrides) {
      for (const lvl of free) {
        const curLen = len[lvl] ?? 0;
        if (curLen <= 0) continue;
        const plus  = { ...len, [lvl]: Math.round(curLen + FD_LEN_STEP_MM) };
        const minus = { ...len, [lvl]: Math.max(1, Math.round(curLen - FD_LEN_STEP_MM)) };
        const lossP = evalLoss(dia, plus,  currentTree).loss;
        const lossM = evalLoss(dia, minus, currentTree).loss;
        const grad = (lossP - lossM) / (2 * FD_LEN_STEP_MM);
        if (Math.abs(grad) < 1e-9) continue;

        let alpha = ALPHA_INITIAL;
        while (alpha >= ALPHA_MIN) {
          const candidate = Math.max(1, Math.round(curLen - alpha * grad));
          if (candidate === curLen) { alpha *= ALPHA_BACKTRACK; continue; }
          const trial = { ...len, [lvl]: candidate };
          const result = evalLoss(dia, trial, currentTree);
          if (result.loss < bestLoss - 1e-6) {
            len[lvl] = candidate;
            lenChanged[lvl] = candidate;
            currentTree = args.rebuildWithLenOverrides(len);
            bestSigma = result.fill;
            bestLoss = result.loss;
            improvedThisStep = true;
            break;
          }
          alpha *= ALPHA_BACKTRACK;
        }
      }
    }

    if (!improvedThisStep) break;
  }

  // STEP 4 — per-CLASS tuning. Asymmetric layouts (Fishbone Grad, T-Runner,
  // Inline) physically need different Ø on different sub-runner sections to
  // balance fill time. We tune by *edge class* (group sharing chain position
  // and segment length) — two symmetric edges in the same class always get
  // the same Ø, preserving "all runners are symmetrical" by construction.
  const diaByEdge: Record<number, number> = {};
  let usedEdgeTuning = false;

  // Run class-mode whenever fill σ is above target, OR whenever λ > 0 and
  // there's still volume σ to flatten. Class-mode is a strict superset of
  // level-mode — for chain layouts it differentiates Section 1 vs Section 2.
  if (bestSigma > target || (lambda > 0 && bestLoss > target)) {
    // Build class list — depth-based runner levels + drops, minus locks.
    const classMap = computeEdgeClasses(currentTree);
    const editableClasses: { key: string; edgeIds: readonly number[] }[] = [];
    for (const [levelKey, classes] of classMap) {
      if (!isTunableLevelKey(levelKey)) continue;
      if (args.lockedLevels.has(levelKey)) continue;
      for (const cls of classes) {
        editableClasses.push({ key: cls.key, edgeIds: cls.edgeIds });
      }
    }
    if (editableClasses.length === 0) {
      // Nothing to refine — keep level-mode result.
    } else {
      // Seed per-class Ø from the current level dia (or first edge).
      const classDia: Record<string, number> = {};
      const edgeToClass = new Map<number, string>();
      for (const cls of editableClasses) {
        const firstEdge = currentTree.edges.find((e) => e.id === cls.edgeIds[0]);
        const lvlDia = firstEdge ? dia[firstEdge.levelKey] : undefined;
        classDia[cls.key] = lvlDia ?? firstEdge?.diaMm ?? D_MIN_MM;
        for (const eid of cls.edgeIds) edgeToClass.set(eid, cls.key);
      }
      usedEdgeTuning = true;

      const evalClassLoss = (
        cdia: Record<string, number>,
      ): { fill: number; vol: number; loss: number } => {
        iterations++;
        const edgesPatched = currentTree.edges.map((e) => {
          const cls = edgeToClass.get(e.id);
          if (cls !== undefined && cdia[cls] !== undefined) {
            return { ...e, diaMm: cdia[cls]! };
          }
          // Locked levels (e.g. user-overridden Main Ø) aren't in
          // editableClasses, so their tree-default Ø would otherwise leak
          // into the eval. Apply the per-level dia map here so the loss
          // reflects the correct anchor configuration, not whatever Ø
          // sat on those edges before the solver was invoked.
          if (isTunableLevelKey(e.levelKey) && dia[e.levelKey] !== undefined) {
            return { ...e, diaMm: dia[e.levelKey]! };
          }
          return e;
        });
        const ft = computeFillBalance({
          tree: { ...currentTree, edges: edgesPatched },
          viscosityPaS: args.viscosityPaS,
          totalFlowMm3PerS: args.totalFlowMm3PerS,
          powerLawN: args.powerLawN,
          cavityVolumeMm3: args.cavityVolumeMm3,
        });
        return {
          fill: ft.imbalanceRatio,
          vol: ft.volumeImbalanceRatio,
          loss: ft.imbalanceRatio + lambda * ft.volumeImbalanceRatio,
        };
      };

      const seeded = evalClassLoss(classDia);
      bestSigma = seeded.fill;
      bestLoss = seeded.loss;

      // Snapshot the seed diameters per class — used by the cascade-bias
      // term so the solver prefers staying near textbook defaults unless
      // a meaningful improvement justifies wandering further.
      const seedDia: Record<string, number> = { ...classDia };

      /**
       * One pass of coordinate descent over a SUBSET of classes. Each call
       * runs until no class can improve the score, then returns. Splitting
       * the descent across class subsets lets us tune sub-runners FIRST
       * (drops frozen) and only escalate to drop tuning once sub asymmetry
       * has been exploited — this matches the engineering convention of
       * sizing runners by cascade and reserving gate-orifice changes for
       * fine vol-balance work, and avoids the local minimum where drops
       * absorb the imbalance and subs stay uniform.
       */
      const runDescent = (subset: { key: string; edgeIds: readonly number[] }[]): void => {
        for (
          let it = 0;
          it < maxIter && (!earlyStopOnFillTarget || bestSigma > target);
          it++
        ) {
          let improvedThisStep = false;
          for (const cls of subset) {
            const cur = classDia[cls.key]!;
            const seed = seedDia[cls.key]!;
            let bestVal = cur;
            let localBest = bestLoss + CASCADE_BIAS_PER_MM * Math.abs(cur - seed);
            for (const candidate of candidatesAround(seed)) {
              if (candidate === cur) continue;
              const trial = { ...classDia, [cls.key]: candidate };
              const result = evalClassLoss(trial);
              // When λ > 0, reject candidates that blow the fill target —
              // we want volume balance *without* sacrificing flow balance.
              if (lambda > 0 && result.fill > Math.max(target, bestSigma) * 1.5) continue;
              const score = result.loss + CASCADE_BIAS_PER_MM * Math.abs(candidate - seed);
              if (score < localBest - 1e-6) {
                localBest = score;
                bestVal = candidate;
              }
            }
            if (bestVal !== cur) {
              classDia[cls.key] = bestVal;
              const result = evalClassLoss(classDia);
              bestSigma = result.fill;
              bestLoss = result.loss;
              improvedThisStep = true;
            }
          }
          if (!improvedThisStep) break;
        }
      };

      // Phase A — tune runner-section classes (subs/main, no drops). This
      // resolves fill imbalance through Ø changes on the runner cascade,
      // following Pye / Beaumont sizing convention.
      const runnerClasses = editableClasses.filter((c) => !c.key.startsWith('L_drop'));
      const dropClasses   = editableClasses.filter((c) =>  c.key.startsWith('L_drop'));
      if (runnerClasses.length > 0) runDescent(runnerClasses);

      // Phase B — tune drops only, with runner sections frozen. Drops
      // primarily affect the per-cavity runner *volume* in chain layouts;
      // letting them move now (after subs have done their work) trims
      // residual vol σ without un-balancing fill.
      if (dropClasses.length > 0) runDescent(dropClasses);

      // Phase C — joint refinement over everything in case Phase A and B
      // left a small residual that responds to coupled moves.
      runDescent(editableClasses);

      // Unroll class diameters back to per-edge map for callers.
      for (const cls of editableClasses) {
        const d = classDia[cls.key]!;
        for (const eid of cls.edgeIds) diaByEdge[eid] = d;
      }
    }
  }

  // Build the final fill-time report from the converged dimensions.
  const finalEdges = currentTree.edges.map((e) => {
    if (usedEdgeTuning && diaByEdge[e.id] !== undefined) {
      return { ...e, diaMm: diaByEdge[e.id]! };
    }
    if (isTunableLevelKey(e.levelKey) && dia[e.levelKey] !== undefined) {
      return { ...e, diaMm: dia[e.levelKey]! };
    }
    return e;
  });
  const finalFt = computeFillBalance({
    tree: { ...currentTree, edges: finalEdges },
    viscosityPaS: args.viscosityPaS,
    totalFlowMm3PerS: args.totalFlowMm3PerS,
    powerLawN: args.powerLawN,
    cavityVolumeMm3: args.cavityVolumeMm3,
  });

  const converged = bestSigma <= target;
  return {
    ok: converged,
    diaByLevel: dia,
    lenByLevel: lenChanged,
    diaByEdge: usedEdgeTuning ? diaByEdge : {},
    finalSigma: bestSigma,
    fillTimes: finalFt,
    iterations,
    converged,
    reason: converged ? undefined : 'did-not-converge',
    hitFloorClamp: hitFloor,
    usedEdgeTuning,
  };
}

function parseDepth(k: string): number {
  const m = depthRe.exec(k);
  return m ? parseInt(m[1]!, 10) : 0;
}

/**
 * The cascade anchor is the *shallowest* locked level — that's the value
 * everything downstream is sized against. If nothing is locked we anchor
 * at depth 0 (the main runner) and let the user's existing Main Ø seed the
 * cascade.
 */
function computeAnchorDepth(allLevels: string[], locked: ReadonlySet<string>): number {
  let anchor = 0;
  for (const k of allLevels) {
    if (locked.has(k)) {
      const d = parseDepth(k);
      if (d > anchor) anchor = d;
    }
  }
  // We want the SHALLOWEST locked level to drive the cascade so deeper
  // levels are derived from it. If multiple locks exist we still only
  // cascade DOWN from the shallowest; the deeper locks are honoured by
  // the lockedLevels set in the caller.
  for (const k of allLevels) {
    if (locked.has(k)) {
      const d = parseDepth(k);
      if (d < anchor || anchor === 0) anchor = d;
    }
  }
  return anchor;
}

function perEdgeLengthByLevel(tree: RunnerTree): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const e of tree.edges) {
    const cur = sums.get(e.levelKey) ?? { total: 0, count: 0 };
    cur.total += e.lenMm;
    cur.count++;
    sums.set(e.levelKey, cur);
  }
  const out = new Map<string, number>();
  for (const [k, { total, count }] of sums) {
    out.set(k, count > 0 ? total / count : 0);
  }
  return out;
}

function perEdgeDiameterByLevel(tree: RunnerTree): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of tree.edges) {
    if (!out.has(e.levelKey)) out.set(e.levelKey, e.diaMm);
  }
  return out;
}

function emptyResult(
  args: RunnerBalanceInputs,
  reason: NonNullable<RunnerBalanceResult['reason']>,
  hitFloor: boolean,
): RunnerBalanceResult {
  const ft = computeFillBalance({
    tree: args.tree,
    viscosityPaS: args.viscosityPaS,
    totalFlowMm3PerS: args.totalFlowMm3PerS,
    powerLawN: args.powerLawN,
    cavityVolumeMm3: args.cavityVolumeMm3,
  });
  return {
    ok: false,
    diaByLevel: { ...args.initialDiaByLevel },
    lenByLevel: {},
    diaByEdge: {},
    finalSigma: ft.imbalanceRatio,
    fillTimes: ft,
    iterations: 0,
    converged: false,
    reason,
    hitFloorClamp: hitFloor,
    usedEdgeTuning: false,
  };
}
