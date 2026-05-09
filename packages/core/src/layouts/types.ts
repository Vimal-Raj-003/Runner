/**
 * Layout generator contract. Every layout engine takes a cavity count
 * and returns a RunnerTree with a sprue root, cavity nodes at the leaves,
 * and junction nodes for branch points.
 *
 * Scene units are millimetres. The HTML prototype used "scene units"
 * where 1 unit = 10 mm; the core uses real millimetres throughout.
 */

import type { RunnerTree } from '../geometry/tree';

export type LayoutId =
  | 'single'
  | 'h_bridge'
  | 'radial'
  | 'fish_sym'
  | 'fish_step'
  | 'fish_one'
  | 'inline'
  | 't_runner'
  | 's_runner'
  | 'cross_main';

export type BalanceType = 'Natural' | 'Artificial' | 'Unbalanced';

export interface LayoutMetadata {
  readonly id: LayoutId;
  readonly label: string;
  readonly description: string;
  readonly balance: BalanceType;
  validate(n: number): { ok: boolean; reason?: string };
  /**
   * Cavity counts at which this layout should be HIDDEN from the toolbar
   * even though `validate(n)` says it works. Used to suppress visually
   * redundant variants (e.g. Fishbone Grad collapses to Fishbone Sym at
   * low N; T-Runner collapses to Inline when there's only one row).
   * Optional — defaults to "always show when valid".
   */
  readonly hiddenAtN?: readonly number[];
  /**
   * Always hide this layout from the toolbar. The generator stays
   * registered so existing saved-state references still resolve, but
   * the toolbar pretends the layout doesn't exist. Used for retired
   * variants (e.g. Fishbone Grad — superseded by the auto-balancer).
   */
  readonly hidden?: boolean;
}

export interface LayoutGenerator extends LayoutMetadata {
  generate(cavityCount: number): RunnerTree;
}

/**
 * Helper: fresh mutable id allocator so every tree has stable,
 * monotonically-increasing node and edge ids.
 */
export class IdGen {
  private n = 0;
  next(): number {
    return this.n++;
  }
}
