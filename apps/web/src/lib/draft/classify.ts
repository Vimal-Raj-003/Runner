/**
 * Bucket a draft angle into one of three manufacturability categories.
 *
 * Thresholds follow the standard injection-mould design rules of thumb:
 *   • α ≥ POSITIVE_THRESHOLD  → mouldable, no special tooling.
 *   • 0 ≤ α < POSITIVE_THRESHOLD → "marginal" — vertical wall risks
 *     scuff / drag during ejection; designers usually push to ≥ 1°.
 *   • α < 0 → undercut — needs a slider, lifter, or collapsing core.
 *
 * The 2° positive threshold is widely cited (Beaumont, Bryce); some
 * shops use 1° on textured surfaces. Tunable via the constants if a
 * material-specific knob shows up later.
 */

export type DraftCategory = 'positive' | 'marginal' | 'undercut';

/** Anything below this is "marginal" or worse. Degrees. */
export const MARGINAL_BELOW = 2;

export function classifyDraftAngle(angleDeg: number): DraftCategory {
  if (angleDeg < 0) return 'undercut';
  if (angleDeg < MARGINAL_BELOW) return 'marginal';
  return 'positive';
}
