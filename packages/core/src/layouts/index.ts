import { hBridgeLayout } from './hBridge';
import { radialLayout } from './radial';
import { fishSymLayout, fishStepLayout, fishOneLayout } from './fishbone';
import { inlineLayout } from './inline';
import { tRunnerLayout } from './tRunner';
import { sRunnerLayout } from './sRunner';
import { crossMainLayout } from './crossMain';
import { singleLayout } from './single';
import type { LayoutGenerator, LayoutId } from './types';

export * from './types';
export * from './build';

export const LAYOUTS: Record<LayoutId, LayoutGenerator> = {
  single: singleLayout,
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

/**
 * Returns layouts that are both VALID at this cavity count AND should be
 * shown in the toolbar. Layouts whose tree is visually identical to
 * another variant at certain N values declare those Ns in `hiddenAtN`
 * (e.g. Fishbone Grad@4 = Fishbone Sym@4) and we filter them out here so
 * the user isn't faced with redundant buttons.
 */
export function validLayouts(n: number): LayoutGenerator[] {
  return Object.values(LAYOUTS).filter(
    (l) => l.validate(n).ok && !l.hidden && !(l.hiddenAtN?.includes(n)),
  );
}
