import { describe, expect, it } from 'vitest';
import { pyeRunnerDiameter, roundToStandardDiameter } from '../src/calc/pye.js';

describe('Pye runner-diameter correlation', () => {
  it('monotonic in part weight for fixed length', () => {
    const small = pyeRunnerDiameter({ partWeightG: 10, runnerLengthMm: 100 }).diameterMm;
    const large = pyeRunnerDiameter({ partWeightG: 100, runnerLengthMm: 100 }).diameterMm;
    expect(large).toBeGreaterThan(small);
  });

  it('monotonic in runner length for fixed weight', () => {
    const short = pyeRunnerDiameter({ partWeightG: 50, runnerLengthMm: 50 }).diameterMm;
    const long = pyeRunnerDiameter({ partWeightG: 50, runnerLengthMm: 200 }).diameterMm;
    expect(long).toBeGreaterThan(short);
  });

  it('golden: 50 g / 126 mm = ~2.4 mm (prototype reference)', () => {
    // Same calculation the HTML panel displayed (first screenshot).
    const d = pyeRunnerDiameter({ partWeightG: 50, runnerLengthMm: 126 }).diameterMm;
    expect(d).toBeCloseTo(2.41, 1);
  });

  it('rounds to half-mm standard, clamped to [3, 13]', () => {
    expect(roundToStandardDiameter(2.4)).toBe(3);
    expect(roundToStandardDiameter(5.3)).toBe(5.5);
    expect(roundToStandardDiameter(15)).toBe(13);
  });

  it('carries the Pye citation', () => {
    const r = pyeRunnerDiameter({ partWeightG: 50, runnerLengthMm: 100 });
    expect(r.citation.source).toContain('Rosato');
  });
});
