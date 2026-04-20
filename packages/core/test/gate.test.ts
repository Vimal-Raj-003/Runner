import { describe, expect, it } from 'vitest';
import { computeGate } from '../src/calc/gate.js';
import { findMaterial } from '../src/materials/seed.js';

describe('Beaumont gate sizing', () => {
  it('gate depth = n · t for PP (n = 0.7)', () => {
    const pp = findMaterial('pp-homo')!;
    const g = computeGate({ wallThicknessMm: 2, projectedAreaMm2: 1000, material: pp });
    expect(g.depthMm).toBeCloseTo(1.4, 3);   // 0.7 × 2
  });

  it('gate width = n · √A / 30 for PP, A = 2500 mm²', () => {
    const pp = findMaterial('pp-homo')!;
    const g = computeGate({ wallThicknessMm: 2, projectedAreaMm2: 2500, material: pp });
    // 0.7 · sqrt(2500) / 30 = 0.7 · 50 / 30 ≈ 1.1667
    expect(g.widthMm).toBeCloseTo(1.1667, 3);
  });

  it('PVC uses higher n (0.9) — thicker gate', () => {
    const pvc = findMaterial('pvc-rigid')!;
    const g = computeGate({ wallThicknessMm: 2, projectedAreaMm2: 1000, material: pvc });
    expect(g.depthMm).toBeCloseTo(1.8, 3);
  });

  it('carries both depth and width citations', () => {
    const pp = findMaterial('pp-homo')!;
    const g = computeGate({ wallThicknessMm: 2, projectedAreaMm2: 1000, material: pp });
    expect(g.citations.depth.source).toMatch(/Beaumont/);
    expect(g.citations.width.source).toMatch(/Beaumont|Rosato/);
  });
});
