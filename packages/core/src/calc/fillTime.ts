/**
 * Per-cavity fill-time calculator using resistance-based flow split.
 *
 * Treats the runner network as a fluid resistor circuit:
 *   • Each segment's hydraulic resistance is R = 128·η·L / (π·D⁴) for a
 *     round channel, with the Rabinowitsch / Menges power-law correction
 *     R' = R · n/(3n+1) for shear-thinning melts.
 *   • At every junction the upstream pressure is fixed, so the flow splits
 *     inversely with each child subtree's total resistance (admittance-
 *     weighted parallel split).
 *   • Per-cavity fill time t_i = V_cavity / Q_i  (steady-state, isothermal).
 *
 * Sources:
 *   Menges & Mohren, *How to Make Injection Molds* (1993)
 *   Beaumont, *Runner and Gating Design Handbook* (2007) §5 — "Runner Balance"
 *   Bird, Stewart, Lightfoot, *Transport Phenomena* (1960)
 */

import { cite, type Citation } from '../citations';
import type { RunnerEdge, RunnerTree } from '../geometry/tree';

export interface FillBalanceInput {
  tree: RunnerTree;
  viscosityPaS: number;
  totalFlowMm3PerS: number;
  /** Optional power-law exponent of the melt. Defaults to Newtonian (no correction). */
  powerLawN?: number;
  /** Volume of a single cavity in mm³ (parts are assumed identical). */
  cavityVolumeMm3: number;
}

export interface FillBalanceResult {
  /** Edge.id → volumetric flow Q (mm³/s) at that edge. */
  perEdgeFlowMm3PerS: Map<number, number>;
  /** Cavity.id → volumetric flow Q arriving at that cavity (mm³/s). */
  perCavityFlowMm3PerS: Map<number, number>;
  /** Cavity.id → predicted fill time (s). */
  perCavityFillTimeS: Map<number, number>;
  /** Cavity.id → total sprue→cavity path length (mm). */
  perCavityPathLengthMm: Map<number, number>;
  /** Cavity.id → total sprue→cavity runner volume (mm³). */
  perCavityVolumeMm3: Map<number, number>;
  meanFillTimeS: number;
  stdDevFillTimeS: number;
  /** σ(t_fill) / mean(t_fill). Production-grade threshold: < 0.05. */
  imbalanceRatio: number;
  /**
   * σ(V_path) / mean(V_path) — runner-volume imbalance across cavities.
   * Independent of fill-time imbalance: a layout can have equal fill but
   * very different per-cavity runner volumes (and therefore wasted shot).
   * Used by the multi-objective balancer.
   */
  volumeImbalanceRatio: number;
  /** True when imbalance ratio < 0.05 (Beaumont 2007 §5). */
  isBalanced: boolean;
  citation: Citation;
}

/** Hydraulic resistance for a round channel in SI units (Pa·s/m³). */
function resistance(eta: number, lenMm: number, diaMm: number, n?: number): number {
  if (lenMm <= 0 || diaMm <= 0 || eta <= 0) return 0;
  const L = lenMm * 1e-3;
  const D = diaMm * 1e-3;
  let R = (128 * eta * L) / (Math.PI * Math.pow(D, 4));
  if (n) R *= n / (3 * n + 1);
  return R;
}

const empty = (): FillBalanceResult => ({
  perEdgeFlowMm3PerS: new Map(),
  perCavityFlowMm3PerS: new Map(),
  perCavityFillTimeS: new Map(),
  perCavityPathLengthMm: new Map(),
  perCavityVolumeMm3: new Map(),
  meanFillTimeS: 0,
  stdDevFillTimeS: 0,
  imbalanceRatio: 0,
  volumeImbalanceRatio: 0,
  isBalanced: true,
  citation: cite('runner_balance'),
});

/** Coefficient-of-variation for a list of finite numbers; 0 if degenerate. */
function coefficientOfVariation(xs: number[]): number {
  const finite = xs.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  if (mean <= 0) return 0;
  const variance = finite.reduce((a, x) => a + (x - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance) / mean;
}

export function computeFillBalance(input: FillBalanceInput): FillBalanceResult {
  const {
    tree,
    viscosityPaS: eta,
    totalFlowMm3PerS: Qtot,
    powerLawN,
    cavityVolumeMm3,
  } = input;

  const sprue = tree.nodes.find((n) => n.kind === 'sprue');
  if (!sprue || tree.cavities.length === 0) return empty();

  // Index children for fast traversal.
  const childrenOf = new Map<number, RunnerEdge[]>();
  for (const e of tree.edges) {
    const arr = childrenOf.get(e.parentNodeId) ?? [];
    arr.push(e);
    childrenOf.set(e.parentNodeId, arr);
  }
  const nodeById = new Map(tree.nodes.map((n) => [n.id, n] as const));

  // Per-edge resistance.
  const Re = new Map<number, number>();
  for (const e of tree.edges) {
    Re.set(e.id, resistance(eta, e.lenMm, e.diaMm, powerLawN));
  }

  // Bottom-up: equivalent resistance from each node down to its cavities.
  // Cavities are treated as zero-resistance sinks, so R_eq at a junction
  // is the parallel combination over its children of (R_edge + R_eq_child).
  const Req = new Map<number, number>();
  const computeReq = (nodeId: number): number => {
    const cached = Req.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeById.get(nodeId);
    if (!node || node.kind === 'cavity') {
      Req.set(nodeId, 0);
      return 0;
    }
    const children = childrenOf.get(nodeId) ?? [];
    let sumInvR = 0;
    for (const e of children) {
      const Rpath = (Re.get(e.id) ?? 0) + computeReq(e.childNodeId);
      if (Rpath > 0) sumInvR += 1 / Rpath;
    }
    const result = sumInvR > 0 ? 1 / sumInvR : 0;
    Req.set(nodeId, result);
    return result;
  };
  computeReq(sprue.id);

  // Top-down: distribute the inlet flow through the network. At each
  // junction the share each child receives is (1/R_path_i) / Σ(1/R_path_j).
  const Qe = new Map<number, number>();
  const Qcav = new Map<number, number>();
  const distribute = (nodeId: number, Qin: number): void => {
    const node = nodeById.get(nodeId);
    if (!node) return;
    if (node.kind === 'cavity') {
      if (node.cavityId !== undefined) Qcav.set(node.cavityId, Qin);
      return;
    }
    const children = childrenOf.get(nodeId) ?? [];
    if (children.length === 0) return;
    const sumInvR = children.reduce((acc, e) => {
      const Rpath = (Re.get(e.id) ?? 0) + (Req.get(e.childNodeId) ?? 0);
      return Rpath > 0 ? acc + 1 / Rpath : acc;
    }, 0);
    if (sumInvR <= 0) {
      // Degenerate: every child path has zero resistance. Split evenly.
      const Qi = Qin / children.length;
      for (const e of children) {
        Qe.set(e.id, Qi);
        distribute(e.childNodeId, Qi);
      }
      return;
    }
    for (const e of children) {
      const Rpath = (Re.get(e.id) ?? 0) + (Req.get(e.childNodeId) ?? 0);
      const share = Rpath > 0 ? (1 / Rpath) / sumInvR : 0;
      const Qi = Qin * share;
      Qe.set(e.id, Qi);
      distribute(e.childNodeId, Qi);
    }
  };
  distribute(sprue.id, Qtot);

  // Per-cavity fill time = V / Q, plus per-path geometry (length and
  // runner volume) for the visual comparison panel.
  const perFill = new Map<number, number>();
  const perPathLen = new Map<number, number>();
  const perPathVol = new Map<number, number>();
  const parentEdgeOf = new Map<number, RunnerEdge>();
  for (const e of tree.edges) parentEdgeOf.set(e.childNodeId, e);
  for (const cav of tree.cavities) {
    const Q = Qcav.get(cav.id) ?? 0;
    perFill.set(cav.id, Q > 0 ? cavityVolumeMm3 / Q : Infinity);

    const cavNode = tree.nodes.find((n) => n.cavityId === cav.id && n.kind === 'cavity');
    let pathLen = 0;
    let pathVol = 0;
    let cur: number | undefined = cavNode?.id;
    while (cur !== undefined && cur !== sprue.id) {
      const e = parentEdgeOf.get(cur);
      if (!e) break;
      pathLen += e.lenMm;
      const r = e.diaMm / 2;
      pathVol += Math.PI * r * r * e.lenMm;
      cur = e.parentNodeId;
    }
    perPathLen.set(cav.id, Math.round(pathLen));
    perPathVol.set(cav.id, Math.round(pathVol));
  }

  const finite = [...perFill.values()].filter((t) => Number.isFinite(t));
  const volRatio = coefficientOfVariation([...perPathVol.values()]);
  if (finite.length < 2) {
    return {
      perEdgeFlowMm3PerS: Qe,
      perCavityFlowMm3PerS: Qcav,
      perCavityFillTimeS: perFill,
      perCavityPathLengthMm: perPathLen,
      perCavityVolumeMm3: perPathVol,
      meanFillTimeS: finite[0] ?? 0,
      stdDevFillTimeS: 0,
      imbalanceRatio: 0,
      volumeImbalanceRatio: volRatio,
      isBalanced: true,
      citation: cite('runner_balance'),
    };
  }
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const variance = finite.reduce((a, t) => a + (t - mean) ** 2, 0) / finite.length;
  const std = Math.sqrt(variance);
  const ratio = mean > 0 ? std / mean : 0;
  return {
    perEdgeFlowMm3PerS: Qe,
    perCavityFlowMm3PerS: Qcav,
    perCavityFillTimeS: perFill,
    perCavityPathLengthMm: perPathLen,
    perCavityVolumeMm3: perPathVol,
    meanFillTimeS: mean,
    stdDevFillTimeS: std,
    imbalanceRatio: ratio,
    volumeImbalanceRatio: volRatio,
    isBalanced: ratio < 0.05,
    citation: cite('runner_balance'),
  };
}
