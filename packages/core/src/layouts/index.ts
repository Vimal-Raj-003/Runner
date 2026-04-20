import { hBridgeLayout } from './hBridge';
import { radialLayout } from './radial';
import { fishSymLayout, fishStepLayout, fishOneLayout } from './fishbone';
import { inlineLayout } from './inline';
import { tRunnerLayout } from './tRunner';
import { sRunnerLayout } from './sRunner';
import { crossMainLayout } from './crossMain';
import type { LayoutGenerator, LayoutId } from './types';

export * from './types';
export * from './build';

export const LAYOUTS: Record<LayoutId, LayoutGenerator> = {
  h_bridge: hBridgeLayout,
  radial: radialLayout,
  fish_sym: fishSymLayout,
  fish_step: fishStepLayout,
  fish_one: fishOneLayout,
  inline: inlineLayout,
  t_runner: tRunnerLayout,
  s_runner: sRunnerLayout,
  cross_main: crossMainLayout,
};

export function getLayout(id: LayoutId): LayoutGenerator {
  return LAYOUTS[id];
}

export function validLayouts(n: number): LayoutGenerator[] {
  return Object.values(LAYOUTS).filter((l) => l.validate(n).ok);
}
