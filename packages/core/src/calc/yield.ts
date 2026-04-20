/**
 * Shot-weight and yield (runner-to-part ratio) calculation.
 *
 *   W_shot = ρ_melt · (V_cavity · N + V_runner)
 *   yield  = V_cavity · N / (V_cavity · N + V_runner)
 *
 *  Source: Rosato, Injection Molding Handbook (2000), §7.2.
 *
 *  Cold-runner systems typically run at 60–85% yield. A hot-runner
 *  system lifts yield effectively to 100% at the cost of hotter tooling
 *  and more complex control.
 */

import { cite, type Citation } from '../citations';
import type { RunnerProfile } from '../profiles';
import { RUNNER_PROFILES } from '../profiles';
import type { RunnerTree } from '../geometry/tree';

export interface YieldResult {
  runnerVolumeMm3: number;
  cavityTotalVolumeMm3: number;
  sprueVolumeMm3: number;
  totalShotVolumeMm3: number;
  shotWeightG: number;
  partFractionPct: number;
  runnerFractionPct: number;
  citation: Citation;
}

export interface YieldInput {
  tree: RunnerTree;
  cavityVolumeMm3: number;
  sprueVolumeMm3: number;
  profile: RunnerProfile;
  meltDensityKgM3: number;
  hotRunner: boolean;
}

export function computeYield(input: YieldInput): YieldResult {
  const factor = RUNNER_PROFILES[input.profile].factor;
  let runnerVol = 0;
  for (const edge of input.tree.edges) {
    const r = edge.diaMm / 2;
    runnerVol += Math.PI * r * r * edge.lenMm * factor;
  }
  const effectiveRunnerVol = input.hotRunner ? 0 : runnerVol;

  const cavVol = input.cavityVolumeMm3 * input.tree.cavities.length;
  const totalShotVol = cavVol + effectiveRunnerVol + input.sprueVolumeMm3;
  const shotWeightG = (input.meltDensityKgM3 * totalShotVol * 1e-9) * 1000;

  return {
    runnerVolumeMm3: runnerVol,
    cavityTotalVolumeMm3: cavVol,
    sprueVolumeMm3: input.sprueVolumeMm3,
    totalShotVolumeMm3: totalShotVol,
    shotWeightG,
    partFractionPct: totalShotVol > 0 ? (cavVol / totalShotVol) * 100 : 100,
    runnerFractionPct: totalShotVol > 0 ? (effectiveRunnerVol / totalShotVol) * 100 : 0,
    citation: cite('shot_weight_yield'),
  };
}
