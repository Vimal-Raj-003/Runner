/**
 * Runner cross-section profiles.
 *
 * `factor` = fill cross-section ratio vs a full circle of the same nominal
 * radius (used for volume calculations).
 * `efficiency` = textbook A/P volume-to-surface ratio, expressed relative
 * to the nominal diameter D (Rosato et al. 2000, §3.2).
 */

export type RunnerProfile = 'round' | 'trapez' | 'mod_trapez' | 'hex' | 'half_round';

export interface RunnerProfileDef {
  readonly id: RunnerProfile;
  readonly label: string;
  readonly factor: number;
  readonly efficiencyRatio: string;
  readonly description: string;
  readonly recommended: boolean;
}

export const RUNNER_PROFILES: Record<RunnerProfile, RunnerProfileDef> = {
  round: {
    id: 'round',
    label: 'Full Round',
    factor: 1.0,
    efficiencyRatio: '0.25D',
    description: 'Most efficient; preferred for 2-plate moulds',
    recommended: true,
  },
  trapez: {
    id: 'trapez',
    label: 'Trapezoidal',
    factor: 0.75,
    efficiencyRatio: '0.165D',
    description: 'Easy to eject; used for multi-plate moulds',
    recommended: true,
  },
  mod_trapez: {
    id: 'mod_trapez',
    label: 'Modified Trapezoid',
    factor: 0.86,
    efficiencyRatio: '0.19D',
    description: '14% more volume than round; compromise profile',
    recommended: true,
  },
  hex: {
    id: 'hex',
    label: 'Hexagonal',
    factor: 0.82,
    efficiencyRatio: '0.21D',
    description: 'Double trapezoid; easy to match mould halves',
    recommended: true,
  },
  half_round: {
    id: 'half_round',
    label: 'Half Round',
    factor: 0.5,
    efficiencyRatio: '0.15D',
    description: 'Not recommended — low volume/surface ratio',
    recommended: false,
  },
};

export function runnerProfile(id: RunnerProfile): RunnerProfileDef {
  return RUNNER_PROFILES[id];
}
