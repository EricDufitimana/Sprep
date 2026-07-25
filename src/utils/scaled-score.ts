/**
 * Estimated SAT Reading & Writing section score (200–800) from a set of graded
 * responses, via a Rasch (1-parameter IRT) ability estimate. Pure — no I/O, no
 * side effects — so it is unit-tested directly (see tests/scaled-score.test.ts).
 *
 * Why not just map percent-correct to a score? The digital SAT R&W is multistage
 * adaptive and scored with IRT, so a hard question answered correctly is worth
 * more than an easy one, and raw percent over an arbitrary practice mix is not
 * comparable across students or sittings. Instead we approximate each question's
 * item-difficulty parameter from its E/M/H tag and estimate the ability θ that
 * best explains the right/wrong pattern. θ maps linearly to 200–800 (θ's
 * population SD of ~1 ≈ the section's ~100-point SD), and the estimate's standard
 * error gives an honest confidence band that widens automatically when there is
 * little evidence at a given ability level (e.g. few hard questions attempted) —
 * mirroring the uncertainty the adaptive "ceiling" creates.
 *
 * This is an ESTIMATE, not an official concordance: real per-test curves differ,
 * and we infer difficulty from a 3-level tag rather than calibrated item
 * parameters. Always label it as such in the UI.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface ScoredResponse {
  difficulty: Difficulty | null;
  isCorrect: boolean;
}

export interface ScaledScoreEstimate {
  /** Point estimate on the 200–800 scale, rounded to the nearest 10. */
  score: number;
  /** ~95% confidence band, each rounded to 10 and clamped to [200, 800]. */
  low: number;
  high: number;
  /** Ability estimate (logits) and its standard error — surfaced for tests. */
  theta: number;
  standardError: number;
  /** Responses with a known difficulty that backed the estimate. */
  sampleSize: number;
}

/** Rasch item difficulty (logits) per tag. Symmetric, spanning ~2.4 logits. */
const DIFFICULTY_B: Record<Difficulty, number> = {
  easy: -1.2,
  medium: 0,
  hard: 1.2,
};

/** Ability prior N(mean, sd²). Regularizes tiny and all-right/all-wrong sets. */
const PRIOR_MEAN = 0;
const PRIOR_SD = 2;
const PRIOR_INFO = 1 / (PRIOR_SD * PRIOR_SD);

/** θ → scaled score. θ=0 → 500; each logit ≈ 100 points. */
const SCORE_CENTER = 500;
const SCORE_PER_LOGIT = 100;
export const SCORE_MIN = 200;
export const SCORE_MAX = 800;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Map an ability (logits) to a clamped, 10-rounded 200–800 score. */
export function thetaToScore(theta: number): number {
  const raw = SCORE_CENTER + SCORE_PER_LOGIT * theta;
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, raw));
  return Math.round(clamped / 10) * 10;
}

/**
 * MAP Rasch ability estimate via Newton–Raphson. Only responses with a known
 * difficulty contribute. The N(0, PRIOR_SD²) prior both handles all-correct /
 * all-incorrect sets (which have no finite MLE) and shrinks small samples toward
 * the mean, so a few lucky answers don't read as 800. Returns null when there is
 * no usable evidence.
 */
export function estimateScaledScore(responses: ScoredResponse[]): ScaledScoreEstimate | null {
  const items: { b: number; x: number }[] = [];
  for (const r of responses) {
    if (r.difficulty === null) continue;
    items.push({ b: DIFFICULTY_B[r.difficulty], x: r.isCorrect ? 1 : 0 });
  }
  if (items.length === 0) return null;

  let theta = PRIOR_MEAN;
  for (let iter = 0; iter < 50; iter++) {
    let grad = -(theta - PRIOR_MEAN) * PRIOR_INFO; // prior contribution
    let info = PRIOR_INFO;
    for (const it of items) {
      const p = sigmoid(theta - it.b);
      grad += it.x - p;
      info += p * (1 - p);
    }
    const step = grad / info;
    theta += step;
    if (Math.abs(step) < 1e-7) break;
  }

  // Standard error from the observed Fisher information at the estimate (logits).
  let info = PRIOR_INFO;
  for (const it of items) {
    const p = sigmoid(theta - it.b);
    info += p * (1 - p);
  }
  const standardError = 1 / Math.sqrt(info);

  return {
    score: thetaToScore(theta),
    low: thetaToScore(theta - 1.96 * standardError),
    high: thetaToScore(theta + 1.96 * standardError),
    theta,
    standardError,
    sampleSize: items.length,
  };
}
