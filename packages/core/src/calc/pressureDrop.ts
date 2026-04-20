/**
 * Pressure-drop calculation for a runner tree.
 *
 *  Newtonian (Hagen-Poiseuille) form, round channel:
 *       ΔP = 128 · η · Q · L / (π · D⁴)
 *
 *  Polymer (power-law) correction — Rabinowitsch/Menges:
 *       ΔP′ = ΔP · (n / (3n + 1))                  round
 *       ΔP′ = ΔP · (n / (2n + 1))                  rectangular
 *
 *  where n is the power-law exponent of the melt.
 *
 *  Inputs: volumetric flow Q in mm³/s, viscosity η in Pa·s, L and D in mm.
 *  Output: ΔP per segment in MPa (converted from Pa for engineer-friendly
 *  display). Sum over a path from sprue → gate gives total ΔP.
 *
 *  Source: Menges & Mohren, *How to Make Injection Molds* (1993);
 *  Bird, Stewart, Lightfoot, *Transport Phenomena* (1960).
 */

import { cite, type Citation } from '../citations';
import type { RunnerEdge, RunnerTree } from '../geometry/tree';

export interface PressureDropInput {
  viscosityPaS: number;
  volumetricFlowMm3PerS: number;  // Q per segment (already split by branch ratio)
  lengthMm: number;
  diameterMm: number;
  powerLawN?: number;             // default 0.35 — typical polymer mean
  shape?: 'round' | 'rect';       // default round
  rectWidthMm?: number;
  rectHeightMm?: number;
}

export function segmentPressureDropMPa(input: PressureDropInput): number {
  const { viscosityPaS: eta, volumetricFlowMm3PerS: Q, lengthMm: L, diameterMm: D } = input;
  if (D <= 0 || L <= 0 || Q <= 0 || eta <= 0) return 0;

  let deltaPPa: number;
  if (input.shape === 'rect' && input.rectWidthMm && input.rectHeightMm) {
    const W = input.rectWidthMm;
    const h = input.rectHeightMm;
    // Rectangular Newtonian formula: ΔP = 12·η·Q·L / (W·h³)
    const Q_SI = Q * 1e-9; // mm³/s → m³/s
    const W_SI = W * 1e-3;
    const h_SI = h * 1e-3;
    const L_SI = L * 1e-3;
    deltaPPa = (12 * eta * Q_SI * L_SI) / (W_SI * h_SI * h_SI * h_SI);
    if (input.powerLawN) deltaPPa *= input.powerLawN / (2 * input.powerLawN + 1);
  } else {
    const Q_SI = Q * 1e-9;
    const D_SI = D * 1e-3;
    const L_SI = L * 1e-3;
    deltaPPa = (128 * eta * Q_SI * L_SI) / (Math.PI * Math.pow(D_SI, 4));
    if (input.powerLawN) deltaPPa *= input.powerLawN / (3 * input.powerLawN + 1);
  }
  return deltaPPa / 1e6; // Pa → MPa
}

export interface TreePressureDropResult {
  perEdgeMPa: Map<number, number>;  // edge.id → ΔP (MPa)
  worstPathMPa: number;             // sprue-to-gate worst-case
  avgPathMPa: number;
  citations: { hagen: Citation; powerLaw: Citation };
}

export interface TreePressureDropInput {
  tree: RunnerTree;
  viscosityPaS: number;
  totalFlowMm3PerS: number;   // total melt flow entering the sprue
  powerLawN?: number;
}

/**
 * Distribute the shot flow through the tree and compute ΔP on every edge.
 *
 * Flow splits equally at each junction by the number of descendant cavities
 * (assumes balanced fill — a reasonable first approximation; the real flow
 * split is a non-linear function of resistance and is left for a future
 * FEA solver).
 */
export function treePressureDrop(input: TreePressureDropInput): TreePressureDropResult {
  const { tree, viscosityPaS, totalFlowMm3PerS } = input;

  // Count cavities downstream of each node for flow-split estimation
  const childrenOf = new Map<number, number[]>();
  for (const e of tree.edges) {
    const arr = childrenOf.get(e.parentNodeId) ?? [];
    arr.push(e.childNodeId);
    childrenOf.set(e.parentNodeId, arr);
  }

  function cavitiesBelow(nodeId: number): number {
    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) return 0;
    if (node.kind === 'cavity') return 1;
    const kids = childrenOf.get(nodeId) ?? [];
    return kids.reduce((a, c) => a + cavitiesBelow(c), 0);
  }

  const perEdgeMPa = new Map<number, number>();
  for (const e of tree.edges) {
    const downstream = cavitiesBelow(e.childNodeId) || 1;
    const flow = totalFlowMm3PerS * (downstream / Math.max(1, tree.cavities.length));
    const dp = segmentPressureDropMPa({
      viscosityPaS,
      volumetricFlowMm3PerS: flow,
      lengthMm: e.lenMm,
      diameterMm: e.diaMm,
      powerLawN: input.powerLawN,
      shape: 'round',
    });
    perEdgeMPa.set(e.id, dp);
  }

  // Walk sprue-to-cavity paths and sum
  const sprue = tree.nodes.find((n) => n.kind === 'sprue');
  const pathSums: number[] = [];
  if (sprue) {
    const parentEdgeOf = new Map<number, RunnerEdge>();
    for (const e of tree.edges) parentEdgeOf.set(e.childNodeId, e);
    for (const cav of tree.cavities) {
      const cavNode = tree.nodes.find((n) => n.cavityId === cav.id && n.kind === 'cavity');
      if (!cavNode) continue;
      let sum = 0;
      let cur: number | undefined = cavNode.id;
      while (cur !== undefined && cur !== sprue.id) {
        const e = parentEdgeOf.get(cur);
        if (!e) break;
        sum += perEdgeMPa.get(e.id) ?? 0;
        cur = e.parentNodeId;
      }
      pathSums.push(sum);
    }
  }

  const worst = pathSums.length ? Math.max(...pathSums) : 0;
  const avg = pathSums.length ? pathSums.reduce((a, b) => a + b, 0) / pathSums.length : 0;

  return {
    perEdgeMPa,
    worstPathMPa: worst,
    avgPathMPa: avg,
    citations: {
      hagen: cite('hagen_poiseuille'),
      powerLaw: cite('power_law_correction'),
    },
  };
}
