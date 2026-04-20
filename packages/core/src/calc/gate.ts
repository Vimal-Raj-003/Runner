/**
 * Gate sizing — Beaumont / Rosato formulas.
 *
 *   h = n · t                   (depth vs wall thickness, 0.6–0.9 by group)
 *   W = n · √A / 30             (width vs projected cavity area, in mm²)
 *   L_land = 0.5–1.0 mm         (recommended land length for manual trim)
 */

import { cite, type Citation } from '../citations';
import type { Material } from '../materials/schema';

export interface GateInput {
  wallThicknessMm: number;
  projectedAreaMm2: number;
  material: Material;
}

export interface GateResult {
  depthMm: number;
  widthMm: number;
  landMm: { min: number; max: number };
  aspectRatio: number; // h / W — recommended 0.5–1.0 to avoid ballooning
  citations: {
    depth: Citation;
    width: Citation;
  };
}

export function computeGate(input: GateInput): GateResult {
  const n = input.material.gateConstantN;
  const depth = n * input.wallThicknessMm;
  const width = (n * Math.sqrt(input.projectedAreaMm2)) / 30;
  return {
    depthMm: depth,
    widthMm: width,
    landMm: { min: 0.5, max: 1.0 },
    aspectRatio: depth / width,
    citations: {
      depth: cite('beaumont_gate_depth'),
      width: cite('beaumont_gate_width'),
    },
  };
}
