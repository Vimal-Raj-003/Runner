import { describe, expect, it } from 'vitest';
import { runCalculations, type CalcInput } from '../src/calc/pipeline.js';
import { findMaterial } from '../src/materials/seed.js';

function baselineInput(): CalcInput {
  const pp = findMaterial('pp-homo')!;
  return {
    part: {
      weightG: 50,
      volumeMm3: 55000,       // ≈ 50 g @ 0.9 g/cc
      wallThicknessMm: 2,
      projectedAreaMm2: 2500, // 50 × 50 mm
      dimsMm: { w: 50, d: 50, h: 30 },
    },
    cavities: 8,
    gatesPerCavity: 1,
    layoutId: 'h_bridge',
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

describe('Top-level pipeline', () => {
  it('produces a deterministic result with citations for every number', () => {
    const r1 = runCalculations(baselineInput());
    const r2 = runCalculations(baselineInput());
    expect(r1.runner.baseDiaMm).toBeCloseTo(r2.runner.baseDiaMm, 6);
    expect(r1.citations.length).toBeGreaterThan(5);
    // At minimum: Pye, Gate, Sprue, Clamp, Hagen-Poiseuille, Freeze
    const ids = r1.citations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([
      'pye_runner_dia',
      'beaumont_gate_depth',
      'menges_freeze_time',
      'hagen_poiseuille',
    ]));
  });

  it('respects diameter overrides — all edges at L0 adopt the override', () => {
    const input = baselineInput();
    input.overrides = { diaByLevel: { L0: 10 } };
    const r = runCalculations(input);
    const mainEdges = r.tree.edges.filter((e) => e.levelKey === 'L0');
    for (const e of mainEdges) expect(e.diaMm).toBeCloseTo(10, 6);
  });

  it('flags cavity overlap as an error warning when spacing is too tight', () => {
    const input = baselineInput();
    input.part.dimsMm = { w: 120, d: 120, h: 30 }; // huge cavities
    const r = runCalculations(input);
    const overlap = r.warnings.find((w) => w.code === 'cavity_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.severity).toBe('error');
  });

  it('returns a valid tree with at least one edge per cavity path', () => {
    const r = runCalculations(baselineInput());
    expect(r.tree.cavities).toHaveLength(8);
    expect(r.tree.edges.length).toBeGreaterThanOrEqual(8);
  });

  it('yield is 100% part fraction in hot-runner mode', () => {
    const input = baselineInput();
    input.hotRunner = true;
    const r = runCalculations(input);
    expect(r.yield.runnerFractionPct).toBeCloseTo(0, 6);
  });

  it('carries calcVersion', () => {
    const r = runCalculations(baselineInput());
    expect(r.calcVersion).toBe('0.1.0');
  });

  // The pipeline runs the hydraulic balancer up-front whenever no user
  // overrides are set. This test confirms that fresh input → balanced state.
  it('default state (no overrides) is hydraulically balanced for an asymmetric layout', () => {
    const input = baselineInput();
    input.layoutId = 'fish_step'; // Fishbone Grad — naturally imbalanced
    input.overrides = {};
    const r = runCalculations(input);
    // imbalanceRatio uses σ(L/D)/mean from the existing balance metric;
    // for a hydraulic-fill-balanced state we expect this to be modest.
    // Looser threshold here than the 2 % production target because the
    // balance metric is L/D variance (not fill-time variance directly).
    expect(r.balance.imbalanceRatio).toBeLessThan(0.15);
  });

  it('symmetric layout (Fishbone Sym) keeps up/down mirror pairs identical after auto-balance', () => {
    const input = baselineInput();
    input.layoutId = 'fish_sym';
    input.overrides = {};
    const r = runCalculations(input);
    // Class-mode tunes per (chain position, length) so up/down mirror pairs
    // (which share both attributes) end up with identical Ø by construction.
    // Group depth-0 edges by (chainPosFromSprue, lenBucket); within each
    // group, every Ø should be identical.
    const sprue = r.tree.nodes.find((n) => n.kind === 'sprue')!;
    const parentEdgeOf = new Map<number, typeof r.tree.edges[number]>();
    for (const e of r.tree.edges) parentEdgeOf.set(e.childNodeId, e);
    const chainPos = (nodeId: number, depth = 0): number => {
      if (nodeId === sprue.id) return 0;
      const edge = parentEdgeOf.get(nodeId);
      if (!edge || depth > 50) return 0;
      return chainPos(edge.parentNodeId, depth + 1) + 1;
    };

    const buckets = new Map<string, number[]>();
    for (const e of r.tree.edges.filter((e) => e.depth === 0)) {
      const lenBucket = Math.round(e.lenMm / 5) * 5;
      const pos = chainPos(e.childNodeId);
      const key = `${pos}|${lenBucket}`;
      const arr = buckets.get(key) ?? [];
      arr.push(e.diaMm);
      buckets.set(key, arr);
    }
    for (const [, dias] of buckets) {
      const min = Math.min(...dias);
      const max = Math.max(...dias);
      expect(max - min).toBeLessThan(0.01);
    }
  });

  // Gate location plumbing: when the user picks a gate point, every drop
  // edge re-targets to land on it. With gy = -3 the drop bottom moves
  // 3 mm deeper into the part, so drop length grows by exactly 3 mm
  // compared to the no-gate baseline.
  it('gate point shifts drop length by |gy| (vertical case)', () => {
    const input = baselineInput();
    input.layoutId = 'h_bridge';
    const baseline = runCalculations(input);
    const baselineDrop = baseline.tree.edges.find((e) => e.isDrop);
    expect(baselineDrop).toBeDefined();
    const baselineLen = baselineDrop!.lenMm;

    const gy = -3;
    const r = runCalculations({ ...input, gate: { partLocalPoint: [0, gy, 0] } });
    for (const e of r.tree.edges) {
      if (!e.isDrop) continue;
      expect(e.lenMm).toBeCloseTo(baselineLen + 3, 3);
    }
  });

  it('gate offset shifts gate junction xz and re-lengthens the sub-runner', () => {
    const input = baselineInput();
    input.layoutId = 'fish_sym';
    const r = runCalculations({ ...input, gate: { partLocalPoint: [5, 0, 0] } });
    // Find a sub-runner edge (depth 1) and confirm its length includes
    // the +5 mm shift in its child gate-junction x position.
    const sub = r.tree.edges.find((e) => e.depth === 1);
    expect(sub).toBeDefined();
    const parent = r.tree.nodes.find((n) => n.id === sub!.parentNodeId)!;
    const child = r.tree.nodes.find((n) => n.id === sub!.childNodeId)!;
    const dx = child.x - parent.x;
    const dz = child.z - parent.z;
    expect(sub!.lenMm).toBeCloseTo(Math.sqrt(dx * dx + dz * dz), 3);
  });

  it('gate field is null/undefined → drop length unchanged from baseline', () => {
    const input = baselineInput();
    const a = runCalculations(input);
    const b = runCalculations({ ...input, gate: undefined });
    const aDrop = a.tree.edges.find((e) => e.isDrop)!;
    const bDrop = b.tree.edges.find((e) => e.isDrop)!;
    expect(aDrop.lenMm).toBeCloseTo(bDrop.lenMm, 6);
  });

  // Auto-spacing: when the user supplies `partOverlapMarginMm > 0`, the
  // pipeline scales the layout up so adjacent cavity centres are at
  // least max(W, D) + margin apart. With a small margin the layout
  // shouldn't change; with a large margin it should expand.
  it('partOverlapMarginMm scales the layout when natural spacing is too tight', () => {
    const input = baselineInput();
    input.part.dimsMm = { w: 120, d: 120, h: 30 };
    const baseline = runCalculations(input);
    const baselineMin = minCavitySpacing(baseline.tree.cavities);

    const scaled = runCalculations({ ...input, partOverlapMarginMm: 20 });
    const scaledMin = minCavitySpacing(scaled.tree.cavities);

    expect(scaledMin).toBeGreaterThanOrEqual(120 + 20 - 1e-6);
    expect(scaledMin).toBeGreaterThan(baselineMin);
  });

  it('partOverlapMarginMm = 0 / undefined preserves legacy spacing', () => {
    const input = baselineInput();
    const a = runCalculations(input);
    const b = runCalculations({ ...input, partOverlapMarginMm: 0 });
    expect(minCavitySpacing(a.tree.cavities))
      .toBeCloseTo(minCavitySpacing(b.tree.cavities), 6);
  });

  // Auto-mirror: with the gate at part-local (0, 0, 12) and a layout
  // that has a separate gate junction (H-Bridge), the pipeline should
  // shift each gate junction along the line from its cavity centre to
  // the upstream junction by r = 12 mm, NOT by a uniform (0, 12)
  // offset. The offset direction therefore varies per cavity and the
  // resulting sub-runner is shorter than |upstream-cavity|.
  it('autoMirrorGate shifts each cavity gate junction toward its upstream junction', () => {
    const input = baselineInput();
    input.layoutId = 'h_bridge';
    input.cavities = 8;
    const r = 12;
    const a = runCalculations({ ...input, gate: { partLocalPoint: [0, 0, r] } });
    const b = runCalculations({
      ...input,
      gate: { partLocalPoint: [0, 0, r] },
      autoMirrorGate: true,
    });
    // Find a top-row cavity (z < 0) — without auto-mirror its drop
    // parent shifted by +z; with auto-mirror it shifts toward the
    // upstream junction (which for a top-row cavity is also at z < 0
    // or 0, NOT at +z). Verify the direction differs.
    const cav = a.tree.cavities.find((c) => c.z < -1e-3);
    expect(cav).toBeDefined();
    const findGateJunction = (calc: typeof a) => {
      const cavNode = calc.tree.nodes.find(
        (n) => n.kind === 'cavity' && n.cavityId === cav!.id,
      )!;
      const drop = calc.tree.edges.find(
        (e) => e.isDrop && e.childNodeId === cavNode.id,
      )!;
      return calc.tree.nodes.find((n) => n.id === drop.parentNodeId)!;
    };
    const aJunction = findGateJunction(a);
    const bJunction = findGateJunction(b);
    // Without auto-mirror: shift is exactly (0, +r) regardless of cavity.
    expect(aJunction.x - cav!.x).toBeCloseTo(0, 3);
    expect(aJunction.z - cav!.z).toBeCloseTo(r, 3);
    // With auto-mirror: gate junction's offset magnitude stays r, but
    // direction now points from cavity toward its upstream junction.
    const aMag = Math.hypot(aJunction.x - cav!.x, aJunction.z - cav!.z);
    const bMag = Math.hypot(bJunction.x - cav!.x, bJunction.z - cav!.z);
    expect(bMag).toBeCloseTo(r, 3);
    expect(bMag).toBeCloseTo(aMag, 3);
    // The direction must differ — the moved gate junction sits
    // somewhere other than (cav.x, cav.z + r).
    expect(Math.hypot(bJunction.x - aJunction.x, bJunction.z - aJunction.z))
      .toBeGreaterThan(1);
  });

  it('autoMirrorGate produces a sub-runner shorter than |upstream - cavity|', () => {
    const input = baselineInput();
    input.layoutId = 'h_bridge';
    input.cavities = 8;
    const r = 15;
    const calc = runCalculations({
      ...input,
      gate: { partLocalPoint: [0, 0, r] },
      autoMirrorGate: true,
    });
    // For each cavity, locate gate junction → sub-runner edge → upstream
    // junction; verify sub-runner length = |upstream - cavity| - r.
    for (const cav of calc.tree.cavities) {
      const cavNode = calc.tree.nodes.find(
        (n) => n.kind === 'cavity' && n.cavityId === cav.id,
      )!;
      const drop = calc.tree.edges.find(
        (e) => e.isDrop && e.childNodeId === cavNode.id,
      )!;
      const gateJunction = calc.tree.nodes.find((n) => n.id === drop.parentNodeId)!;
      const subEdge = calc.tree.edges.find(
        (e) => !e.isDrop && e.childNodeId === gateJunction.id,
      );
      if (!subEdge) continue;
      const upstream = calc.tree.nodes.find((n) => n.id === subEdge.parentNodeId);
      if (!upstream) continue;
      const upToCavity = Math.hypot(upstream.x - cav.x, upstream.z - cav.z);
      // Skip degenerate cases where upstream ≈ cavity (drop-only-from-sprue).
      if (upToCavity < 1e-3) continue;
      // sub-runner = |upstream - moved gate junction| = |upstream - cavity| - r
      // (since gate junction sits between upstream and cavity at distance r).
      expect(subEdge.lenMm).toBeCloseTo(upToCavity - r, 2);
    }
  });
});

function minCavitySpacing(cs: Array<{ x: number; z: number }>): number {
  let min = Infinity;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i]!;
      const b = cs[j]!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 0 && d < min) min = d;
    }
  }
  return min;
}
