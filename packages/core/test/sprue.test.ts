import { describe, expect, it } from 'vitest';
import { computeSprue } from '../src/calc/sprue.js';

describe('DME/HASCO sprue bush', () => {
  it('orifice = nozzle + 0.75 mm', () => {
    const s = computeSprue({ nozzleDiaMm: 4, sprueLengthMm: 75 });
    expect(s.orificeMm).toBeCloseTo(4.75, 3);
  });

  it('exit dia grows linearly with length at fixed 2° taper', () => {
    const short = computeSprue({ nozzleDiaMm: 4, sprueLengthMm: 50 });
    const long  = computeSprue({ nozzleDiaMm: 4, sprueLengthMm: 100 });
    expect(long.exitDiaMm).toBeGreaterThan(short.exitDiaMm);
  });

  it('volume is positive and a frustum, not a cylinder', () => {
    const s = computeSprue({ nozzleDiaMm: 4, sprueLengthMm: 75 });
    const cylApprox = Math.PI * (s.orificeMm / 2) ** 2 * 75;
    expect(s.volumeMm3).toBeGreaterThan(cylApprox); // frustum > small cylinder
  });
});
