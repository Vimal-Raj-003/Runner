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
});
