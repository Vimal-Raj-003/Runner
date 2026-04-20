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
