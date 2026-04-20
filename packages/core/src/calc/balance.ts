/**
 * Runner-balance check.
 *
 *  For a naturally balanced layout (H-bridge, radial, S-runner) every
 *  sprue → cavity path should share identical length-to-diameter ratio
 *  and identical total volume. Departure from this produces unequal
 *  shot distribution and short/over-pack defects.
 *
 *  Metric:  imbalance_ratio = σ(L/D) / mean(L/D)
 *  Flag if  imbalance_ratio > 0.10 (Beaumont 2007 rule of thumb).
 */

import { cite, type Citation } from '../citations';
import type { RunnerEdge, RunnerTree } from '../geometry/tree';

export interface PathResult {
  cavityId: number;
  lengthMm: number;
  averageDiaMm: number;
  lOverD: number;
  volumeMm3: number;
}

export interface BalanceResult {
  paths: PathResult[];
  meanLOverD: number;
  stdDevLOverD: number;
  imbalanceRatio: number;
  isBalanced: boolean;
  citation: Citation;
}

export function analyseBalance(tree: RunnerTree): BalanceResult {
  const sprue = tree.nodes.find((n) => n.kind === 'sprue');
  if (!sprue) {
    return emptyResult();
  }
  const parentEdgeOf = new Map<number, RunnerEdge>();
  for (const e of tree.edges) parentEdgeOf.set(e.childNodeId, e);

  const paths: PathResult[] = [];
  for (const cav of tree.cavities) {
    const cavNode = tree.nodes.find((n) => n.cavityId === cav.id && n.kind === 'cavity');
    if (!cavNode) continue;

    let totalLen = 0;
    let totalVol = 0;
    let weightedDia = 0;
    let cur: number | undefined = cavNode.id;
    while (cur !== undefined && cur !== sprue.id) {
      const e = parentEdgeOf.get(cur);
      if (!e) break;
      totalLen += e.lenMm;
      weightedDia += e.diaMm * e.lenMm;
      const r = e.diaMm / 2;
      totalVol += Math.PI * r * r * e.lenMm;
      cur = e.parentNodeId;
    }
    const avgDia = totalLen > 0 ? weightedDia / totalLen : 0;
    paths.push({
      cavityId: cav.id,
      lengthMm: totalLen,
      averageDiaMm: avgDia,
      lOverD: avgDia > 0 ? totalLen / avgDia : 0,
      volumeMm3: totalVol,
    });
  }

  if (paths.length < 2) {
    return {
      paths,
      meanLOverD: paths[0]?.lOverD ?? 0,
      stdDevLOverD: 0,
      imbalanceRatio: 0,
      isBalanced: true,
      citation: cite('runner_balance'),
    };
  }

  const mean = paths.reduce((a, p) => a + p.lOverD, 0) / paths.length;
  const variance = paths.reduce((a, p) => a + (p.lOverD - mean) ** 2, 0) / paths.length;
  const std = Math.sqrt(variance);
  const ratio = mean > 0 ? std / mean : 0;
  return {
    paths,
    meanLOverD: mean,
    stdDevLOverD: std,
    imbalanceRatio: ratio,
    isBalanced: ratio < 0.10,
    citation: cite('runner_balance'),
  };
}

function emptyResult(): BalanceResult {
  return {
    paths: [],
    meanLOverD: 0,
    stdDevLOverD: 0,
    imbalanceRatio: 0,
    isBalanced: true,
    citation: cite('runner_balance'),
  };
}
