import { describe, expect, it } from 'vitest';
import { LAYOUTS, validLayouts } from '../src/layouts/index.js';

describe('Layout generators', () => {
  it('H-Bridge only accepts 2ⁿ', () => {
    expect(LAYOUTS.h_bridge.validate(8).ok).toBe(true);
    expect(LAYOUTS.h_bridge.validate(6).ok).toBe(false);
  });

  it('Radial accepts 2–24', () => {
    expect(LAYOUTS.radial.validate(12).ok).toBe(true);
    expect(LAYOUTS.radial.validate(25).ok).toBe(false);
  });

  it('S-Runner only n=2', () => {
    expect(LAYOUTS.s_runner.validate(2).ok).toBe(true);
    expect(LAYOUTS.s_runner.validate(4).ok).toBe(false);
  });

  it('H-Bridge(8) produces 8 cavities, a sprue root, and a non-empty edge list', () => {
    const t = LAYOUTS.h_bridge.generate(8);
    expect(t.cavities).toHaveLength(8);
    expect(t.nodes.some((n) => n.kind === 'sprue')).toBe(true);
    expect(t.edges.length).toBeGreaterThan(0);
  });

  it('Radial(6) has exactly one sprue and 6 cavities with edges direct from sprue', () => {
    const t = LAYOUTS.radial.generate(6);
    expect(t.cavities).toHaveLength(6);
    const sprue = t.nodes.find((n) => n.kind === 'sprue');
    expect(sprue).toBeTruthy();
    // Every edge at depth 0 starts at sprue
    const mainEdges = t.edges.filter((e) => e.depth === 0);
    expect(mainEdges.every((e) => e.parentNodeId === sprue!.id)).toBe(true);
    expect(mainEdges).toHaveLength(6);
  });

  it('All layouts classify as Natural, Artificial or Unbalanced', () => {
    for (const layout of Object.values(LAYOUTS)) {
      expect(['Natural', 'Artificial', 'Unbalanced']).toContain(layout.balance);
    }
  });

  it('validLayouts(8) lists H-Bridge among valid options', () => {
    const ids = validLayouts(8).map((l) => l.id);
    expect(ids).toContain('h_bridge');
    expect(ids).not.toContain('s_runner');
  });
});
