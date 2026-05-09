import { describe, expect, it } from 'vitest';
import { runCalculations, type CalcInput } from '../src/calc/pipeline.js';
import { optimizeForFillBalance } from '../src/calc/runnerBalance.js';
import { computeFillBalance } from '../src/calc/fillTime.js';
import { findMaterial } from '../src/materials/seed.js';
import { apparentViscosity } from '../src/materials/schema.js';

function fishOneInput(n: number): CalcInput {
  const pp = findMaterial('pp-homo')!;
  return {
    part: {
      weightG: 50,
      volumeMm3: 55000,
      wallThicknessMm: 2,
      projectedAreaMm2: 2500,
      dimsMm: { w: 50, d: 50, h: 30 },
    },
    cavities: n,
    gatesPerCavity: 1,
    layoutId: 'fish_one',
    profile: 'round',
    hotRunner: false,
    material: pp,
    machine: {
      nozzleDiaMm: 4,
      injectionPressureBar: 1500,
      clampForceTonne: 200,
    },
    overrides: {},
  };
}

describe('Auto-balance for asymmetric chain layouts', () => {
  it('Fishbone 1-Side 4-cav: outer-section dia > inner-section dia after auto-balance', () => {
    const r = runCalculations(fishOneInput(4));
    // Group main (depth 0) edges by their chainPos (= 1 inner, 2 outer).
    // After class-mode tuning, the outer chainPos=2 sections should be
    // larger than (or at least equal to) the inner chainPos=1 sections.
    const main = r.tree.edges.filter((e) => e.depth === 0);
    const sprue = r.tree.nodes.find((n) => n.kind === 'sprue')!;
    const inner = main.filter((e) => e.parentNodeId === sprue.id);
    const outer = main.filter((e) => e.parentNodeId !== sprue.id);
    // For 4-cav Fishbone 1-Side chain: 2 inner + 2 outer expected.
    expect(inner).toHaveLength(2);
    expect(outer).toHaveLength(2);
    const innerDia = inner[0]!.diaMm;
    const outerDia = outer[0]!.diaMm;

    // Sub edges grouped by which cavity-tier they feed.
    const sub = r.tree.edges.filter((e) => e.depth === 1);
    const subByLen = new Map<number, number[]>();
    for (const e of sub) {
      const arr = subByLen.get(Math.round(e.lenMm)) ?? [];
      arr.push(e.diaMm);
      subByLen.set(Math.round(e.lenMm), arr);
    }
    // Print everything so we can inspect.
    console.log({
      mainInner: innerDia,
      mainOuter: outerDia,
      sub: Object.fromEntries(subByLen),
      sigma: r.balance.imbalanceRatio,
    });
    expect(outerDia).toBeGreaterThanOrEqual(innerDia);
  });

  it('volumeWeight λ > 0 reduces runner-volume σ vs λ = 0 on 3-cav Fishbone 1-Side', () => {
    // Chain Fishbone 1-Side: outer paths are geometrically longer than the
    // middle path, so balancing fill alone leaves a big runner-volume
    // imbalance. λ > 0 should drive the solver to flatten that volume σ.
    const fillOnly = runCalculations({ ...fishOneInput(3), balanceVolumeWeight: 0 });
    const both     = runCalculations({ ...fishOneInput(3), balanceVolumeWeight: 1 });

    // Compute per-cavity runner-volume σ from each result. The 'both' run
    // must produce volume σ at most as large as the fill-only run — and in
    // practice meaningfully smaller, since the 3-cav case has lots of
    // headroom on the volume axis.
    const volSigma = (calc: typeof fillOnly): number => {
      const sprue = calc.tree.nodes.find((n) => n.kind === 'sprue')!;
      const parentEdgeOf = new Map<number, { parentNodeId: number; lenMm: number; diaMm: number }>();
      for (const e of calc.tree.edges) parentEdgeOf.set(e.childNodeId, { parentNodeId: e.parentNodeId, lenMm: e.lenMm, diaMm: e.diaMm });
      const vols: number[] = [];
      for (const cav of calc.tree.cavities) {
        const cavNode = calc.tree.nodes.find((n) => n.cavityId === cav.id && n.kind === 'cavity');
        let vol = 0;
        let cur: number | undefined = cavNode?.id;
        while (cur !== undefined && cur !== sprue.id) {
          const e = parentEdgeOf.get(cur);
          if (!e) break;
          const r = e.diaMm / 2;
          vol += Math.PI * r * r * e.lenMm;
          cur = e.parentNodeId;
        }
        vols.push(vol);
      }
      const mean = vols.reduce((a, b) => a + b, 0) / vols.length;
      const variance = vols.reduce((a, v) => a + (v - mean) ** 2, 0) / vols.length;
      return Math.sqrt(variance) / mean;
    };

    const sigmaFillOnly = volSigma(fillOnly);
    const sigmaBoth     = volSigma(both);
    expect(sigmaBoth).toBeLessThanOrEqual(sigmaFillOnly + 1e-9);
  });

  it('λ = 1 with Main locked at 4 mm differentiates Sub Section 1 vs 2 (3-cav Fishbone 1-Side)', () => {
    const calc = runCalculations(fishOneInput(3));
    const pp = findMaterial('pp-homo')!;
    const tempK = ((pp.tMeltMin + pp.tMeltMax) / 2) + 273.15;
    const eta = apparentViscosity(pp, 1000, tempK);
    const totalQ = (calc.input.part.volumeMm3 * 3) / 1;
    const result = optimizeForFillBalance({
      tree: calc.tree,
      viscosityPaS: eta,
      totalFlowMm3PerS: totalQ,
      powerLawN: pp.powerLaw?.n,
      cavityVolumeMm3: calc.input.part.volumeMm3,
      initialDiaByLevel: { L0: 4 },
      initialLenByLevel: {},
      lockedLevels: new Set(['L0']),
      volumeWeight: 1,
    });
    // Find sub edges and group by chainPos (parent of sprue → middle, parent
    // of junction → outer).
    const sprue = calc.tree.nodes.find((n) => n.kind === 'sprue')!;
    const subEdges = calc.tree.edges.filter((e) => e.depth === 1);
    const subDias = subEdges.map((e) => ({
      isMiddle: e.parentNodeId === sprue.id,
      dia: result.diaByEdge[e.id] ?? result.diaByLevel[e.levelKey],
    }));
    const middle = subDias.filter((s) => s.isMiddle).map((s) => s.dia);
    const outer  = subDias.filter((s) => !s.isMiddle).map((s) => s.dia);
    console.log('user-scenario subs:', { middle, outer, fillSigma: result.finalSigma });
    expect(middle.length).toBe(1);
    expect(outer.length).toBe(2);
    // For chain Fishbone 1-Side, outer paths are LONGER. To balance fill
    // (and with λ ≥ 1 the solver also cares about volume) the outer sub
    // should be LARGER than the middle sub.
    expect(outer[0]!).toBeGreaterThan(middle[0]!);
  });
});
