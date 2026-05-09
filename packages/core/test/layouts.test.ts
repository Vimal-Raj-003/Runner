import { describe, expect, it } from 'vitest';
import { LAYOUTS, validLayouts } from '../src/layouts/index.js';
import { computeEdgeClasses } from '../src/geometry/edgeClasses.js';

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

  // Regression guard: fishbone Sym/Grad uses a CHAIN spine — each spine
  // junction's parent is the previous junction, NOT the sprue. The user-
  // visible "Section 2 length" is therefore the segment length between
  // junction 1 and junction 2, not sprue → junction 2.
  it('Fishbone Sym(8) spine is a chain, not a star from the sprue', () => {
    const t = LAYOUTS.fish_sym.generate(8);
    const sprue = t.nodes.find((n) => n.kind === 'sprue')!;
    const mainEdges = t.edges.filter((e) => e.depth === 0);
    const fromSprue = mainEdges.filter((e) => e.parentNodeId === sprue.id);
    // 8 cavities = 4 pairs, distributed 2 above + 2 below sprue. Each side's
    // chain head connects to sprue, deeper junctions connect to each other.
    expect(fromSprue.length).toBe(2);
    expect(mainEdges.length - fromSprue.length).toBe(2);
  });

  // Inline odd-N regression: middle cavity sits ON the sprue; we use
  // addDropOnlyCavity to skip the phantom zero-length main edge so the
  // panel doesn't show "Section 1 0mm ×1" alongside the real outer mains.
  it('Inline(3) has no zero-length main edge', () => {
    const t = LAYOUTS.inline.generate(3);
    const mains = t.edges.filter((e) => e.depth === 0);
    expect(mains).toHaveLength(2);
    expect(mains.every((e) => e.lenMm > 0)).toBe(true);
  });

  it('Inline(3) panel sees 1 main class and 2 drop classes', () => {
    const classes = computeEdgeClasses(LAYOUTS.inline.generate(3));
    expect(classes.get('L0')?.length).toBe(1);
    expect(classes.get('L_drop')?.length).toBe(2);
  });

  it('Inline(5) panel sees 2 main classes and 3 drop classes', () => {
    const classes = computeEdgeClasses(LAYOUTS.inline.generate(5));
    // Main: outer pair (length 160) + inner pair (length 80) = 2 classes
    expect(classes.get('L0')?.length).toBe(2);
    // Drops: middle (chainPos 1) + inner pair + outer pair = 3 classes
    expect(classes.get('L_drop')?.length).toBe(3);
  });

  // Cross Main is a CHAIN per arm — each section is a distinct tube
  // segment along the arm, no overlapping geometry. 12-cav has 3 cavities
  // per arm, so 3 main-runner sections (chainPos 1, 2, 3); 16-cav has 4.
  it('Cross Main(12) has 3 main-runner sections (chained per arm)', () => {
    const t = LAYOUTS.cross_main.generate(12);
    const classes = computeEdgeClasses(t);
    const mainClasses = classes.get('L0') ?? [];
    expect(mainClasses.length).toBe(3);
    for (const c of mainClasses) {
      expect(c.count).toBe(4); // one section per arm × 4 arms
    }
  });

  it('Cross Main(16) has 4 main-runner sections', () => {
    const t = LAYOUTS.cross_main.generate(16);
    const classes = computeEdgeClasses(t);
    const mainClasses = classes.get('L0') ?? [];
    expect(mainClasses.length).toBe(4);
  });

  it('Cross Main no longer creates overlapping main edges from the sprue', () => {
    const t = LAYOUTS.cross_main.generate(12);
    const sprue = t.nodes.find((n) => n.kind === 'sprue')!;
    const mainsFromSprue = t.edges.filter(
      (e) => e.depth === 0 && e.parentNodeId === sprue.id,
    );
    // Only 4 chain heads (one per arm), not 16+ overlapping edges.
    expect(mainsFromSprue.length).toBe(4);
  });

  it('Inline(4) panel sees 2 main classes and 2 drop classes', () => {
    const classes = computeEdgeClasses(LAYOUTS.inline.generate(4));
    expect(classes.get('L0')?.length).toBe(2);
    expect(classes.get('L_drop')?.length).toBe(2);
  });

  // Chain topology: Section 1's main edges are children of the sprue;
  // Section 2's main edges are NOT children of the sprue (their parent is
  // an inner gate). Without this property, highlighting Section 2 would
  // light up edges that pass through the sprue — which is wrong because
  // the user expects two separated bars at the outer ends.
  it('Inline(4) Section 2 main edges are not children of the sprue', () => {
    const t = LAYOUTS.inline.generate(4);
    const classes = computeEdgeClasses(t);
    const mainClasses = classes.get('L0') ?? [];
    expect(mainClasses).toHaveLength(2);
    const sprue = t.nodes.find((n) => n.kind === 'sprue')!;
    const edgesById = new Map(t.edges.map((e) => [e.id, e] as const));
    // Section 1: chainPos 1 → both edges parented to the sprue.
    const s1 = mainClasses[0]!;
    for (const id of s1.edgeIds) {
      expect(edgesById.get(id)!.parentNodeId).toBe(sprue.id);
    }
    // Section 2: chainPos 2 → neither edge parented to the sprue.
    const s2 = mainClasses[1]!;
    for (const id of s2.edgeIds) {
      expect(edgesById.get(id)!.parentNodeId).not.toBe(sprue.id);
    }
  });

  it('Inline(5) main runner is a chain — 4 edges, 2 from sprue, 2 chained', () => {
    const t = LAYOUTS.inline.generate(5);
    const sprue = t.nodes.find((n) => n.kind === 'sprue')!;
    const mains = t.edges.filter((e) => e.depth === 0);
    expect(mains).toHaveLength(4);
    const fromSprue = mains.filter((e) => e.parentNodeId === sprue.id);
    expect(fromSprue).toHaveLength(2);
  });

  // hiddenAtN: redundant variants are filtered from validLayouts so they
  // don't show up in the toolbar at cavity counts where they collapse to
  // another layout's output.
  it('validLayouts(2) excludes Radial and Inline (redundant with H-Bridge / S-Runner)', () => {
    const ids = validLayouts(2).map((l) => l.id);
    expect(ids).toContain('h_bridge');
    expect(ids).toContain('s_runner');
    expect(ids).not.toContain('radial');
    expect(ids).not.toContain('inline');
  });

  it('validLayouts(4) excludes T-Runner and Fishbone Grad', () => {
    const ids = validLayouts(4).map((l) => l.id);
    expect(ids).toContain('inline');
    expect(ids).toContain('fish_sym');
    expect(ids).not.toContain('t_runner');
    expect(ids).not.toContain('fish_step');
  });

  it('validLayouts(6) excludes T-Runner and Fishbone Grad', () => {
    const ids = validLayouts(6).map((l) => l.id);
    expect(ids).toContain('inline');
    expect(ids).toContain('fish_sym');
    expect(ids).not.toContain('t_runner');
    expect(ids).not.toContain('fish_step');
  });

  it('Fishbone Grad is hidden at every cavity count (retired variant)', () => {
    for (const n of [4, 6, 8, 10, 12, 16, 24, 32]) {
      const ids = validLayouts(n).map((l) => l.id);
      expect(ids).not.toContain('fish_step');
    }
  });

  it('T-Runner is hidden at 8 and 10 cavities (single-row degenerate)', () => {
    for (const n of [4, 6, 8, 10]) {
      const ids = validLayouts(n).map((l) => l.id);
      expect(ids).not.toContain('t_runner');
    }
    // Still visible at 12 where rows ≥ 2 yields a real T-shape.
    expect(validLayouts(12).map((l) => l.id)).toContain('t_runner');
  });

  it('Fishbone segment length is incremental — 2nd segment\'s parent is 1st junction', () => {
    const t = LAYOUTS.fish_sym.generate(8);
    const sprue = t.nodes.find((n) => n.kind === 'sprue')!;
    // Pick a chain head (depth-0 edge whose parent is the sprue).
    const head = t.edges.find((e) => e.depth === 0 && e.parentNodeId === sprue.id);
    expect(head).toBeTruthy();
    // The next edge in the chain has parentNodeId === head.childNodeId (NOT sprue).
    const next = t.edges.find(
      (e) => e.depth === 0 && e.parentNodeId === head!.childNodeId,
    );
    expect(next).toBeTruthy();
    expect(next!.parentNodeId).not.toBe(sprue.id);
  });
});
