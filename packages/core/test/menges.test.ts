import { describe, expect, it } from 'vitest';
import { computeFreezeTime } from '../src/calc/thermal.js';
import { findMaterial } from '../src/materials/seed.js';

describe('Menges/Ballman freeze time', () => {
  it('PP, 2 mm wall, 240→40→90 °C gives plausible few-seconds freeze time', () => {
    const pp = findMaterial('pp-homo')!;
    const f = computeFreezeTime({
      wallThicknessMm: 2,
      meltTempC: 240,
      mouldTempC: 40,
      ejectionTempC: 90,
      material: pp,
    });
    // Menges worked example for PP ≈ 5–15 s for 2 mm wall
    expect(f.freezeTimeS).toBeGreaterThan(1);
    expect(f.freezeTimeS).toBeLessThan(30);
  });

  it('scales with wall thickness squared (4× wall → ~16× time)', () => {
    const pp = findMaterial('pp-homo')!;
    const thin = computeFreezeTime({
      wallThicknessMm: 1,
      meltTempC: 240, mouldTempC: 40, ejectionTempC: 90, material: pp,
    });
    const thick = computeFreezeTime({
      wallThicknessMm: 4,
      meltTempC: 240, mouldTempC: 40, ejectionTempC: 90, material: pp,
    });
    const ratio = thick.freezeTimeS / thin.freezeTimeS;
    expect(ratio).toBeCloseTo(16, 0); // within 0 decimal places
  });

  it('returns zero when ejection temp ≥ melt temp (invalid input)', () => {
    const pp = findMaterial('pp-homo')!;
    const f = computeFreezeTime({
      wallThicknessMm: 2,
      meltTempC: 200, mouldTempC: 40, ejectionTempC: 250, material: pp,
    });
    expect(f.freezeTimeS).toBe(0);
  });
});
