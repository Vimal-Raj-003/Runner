/**
 * Suitability scoring for candidate gate locations.
 *
 * Combines four physical criteria into a single normalised score:
 *   - thickness         (higher local wall thickness → better; gate freezes
 *                        last, packing pressure reaches the part)
 *   - centrality        (smaller max-flow-length → better; balanced fill,
 *                        less injection pressure required)
 *   - flow balance      (smaller stddev of flow distances → better; even
 *                        flow front, fewer weld lines)
 *   - L/t compliance    (penalty when L_max / thickness exceeds the
 *                        material's flow-length ratio limit)
 *
 * The first three are normalised across THE CANDIDATE SET so the score
 * is always comparable within a single run regardless of the part's
 * absolute thickness or size. The L/t penalty is uncapped — a candidate
 * that exceeds the material limit gets crushed even if it scores well
 * on the positives.
 *
 * Weights match the Moldflow / Beaumont ranking: thickness dominates,
 * centrality second, balance third. Refinable via an explicit options
 * arg later; v1 hardcodes the canonical weights.
 */

export interface ScoringInput {
  /** Local wall thickness at each candidate (parallel to other arrays). */
  thicknesses: Float32Array;
  /** Max flow distance from each candidate to any vertex. */
  lMax: Float32Array;
  /** Stddev of flow distances from each candidate. */
  lStddev: Float32Array;
  /** Material's L/t ratio limit. */
  ltLimit: number;
}

export interface ScoredCandidate {
  index: number;        // index into the input arrays
  score: number;        // composite score (higher = better)
  thicknessNorm: number;
  centralityNorm: number;
  balanceNorm: number;
  ltExcess: number;
  ltRatio: number;
}

// Weights tuned for "balanced filling" — thickness still dominates
// (thick-to-thin principle) but centrality is bumped to 0.40 so the
// suggested gate gravitates toward the part centre, equalising flow
// length to all extremities. Balance term (flow-distance evenness)
// stays at 0.20. L/t excess is uncapped on the negative side so any
// candidate exceeding the material's flow-length-ratio limit is
// crushed regardless of how it scores on the positives.
const W_THICK = 0.40;
const W_CENTRALITY = 0.40;
const W_BALANCE = 0.20;
const W_LT_PENALTY = 1.00;

/**
 * Score every candidate. Returns a parallel array of ScoredCandidate
 * objects. The caller sorts / picks the top.
 */
export function scoreCandidates(input: ScoringInput): ScoredCandidate[] {
  const n = input.thicknesses.length;
  if (n === 0) return [];

  // Min/max for normalisation. We treat zero thickness (escape ray) as
  // unusable — set normalised contribution to 0 in that case.
  let tMin = Infinity, tMax = -Infinity;
  let lmMin = Infinity, lmMax = -Infinity;
  let lsMin = Infinity, lsMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = input.thicknesses[i]!;
    if (t > 0) {
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    const lm = input.lMax[i]!;
    if (Number.isFinite(lm)) {
      if (lm < lmMin) lmMin = lm;
      if (lm > lmMax) lmMax = lm;
    }
    const ls = input.lStddev[i]!;
    if (Number.isFinite(ls)) {
      if (ls < lsMin) lsMin = ls;
      if (ls > lsMax) lsMax = ls;
    }
  }

  const tRange = Math.max(1e-9, tMax - tMin);
  const lmRange = Math.max(1e-9, lmMax - lmMin);
  const lsRange = Math.max(1e-9, lsMax - lsMin);

  const out: ScoredCandidate[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = input.thicknesses[i]!;
    const lm = input.lMax[i]!;
    const ls = input.lStddev[i]!;

    const thicknessNorm = t > 0 ? (t - tMin) / tRange : 0;
    const centralityNorm = Number.isFinite(lm) ? (lm - lmMin) / lmRange : 1;
    const balanceNorm = Number.isFinite(ls) ? (ls - lsMin) / lsRange : 1;

    const ltRatio = t > 0 ? lm / t : Number.POSITIVE_INFINITY;
    const ltExcess = input.ltLimit > 0
      ? Math.max(0, ltRatio - input.ltLimit) / input.ltLimit
      : 0;

    const score =
      W_THICK * thicknessNorm
      + W_CENTRALITY * (1 - centralityNorm)
      + W_BALANCE * (1 - balanceNorm)
      - W_LT_PENALTY * ltExcess;

    out[i] = { index: i, score, thicknessNorm, centralityNorm, balanceNorm, ltExcess, ltRatio };
  }

  return out;
}

/**
 * Map a polymer viscosity class to a flow-length-ratio limit (L/t).
 * Standard rule-of-thumb numbers from injection-mould handbooks
 * (Beaumont, Bryce). Higher viscosity → tighter limit because the melt
 * loses pressure faster along the flow path.
 */
export function ltLimitForViscosity(viscosity: 'low' | 'medium' | 'high'): number {
  switch (viscosity) {
    case 'low':    return 280;
    case 'medium': return 220;
    case 'high':   return 170;
  }
}
