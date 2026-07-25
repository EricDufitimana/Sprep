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

function toItems(responses: ScoredResponse[]): { b: number; x: number }[] {
  const items: { b: number; x: number }[] = [];
  for (const r of responses) {
    if (r.difficulty === null) continue;
    items.push({ b: DIFFICULTY_B[r.difficulty], x: r.isCorrect ? 1 : 0 });
  }
  return items;
}

/**
 * MAP Rasch ability estimate via Newton–Raphson. The N(0, PRIOR_SD²) prior both
 * handles all-correct / all-incorrect sets (which have no finite MLE) and shrinks
 * small samples toward the mean, so a few lucky answers don't read as 800.
 * Returns the ability (logits) and the observed Fisher information at it (the
 * inverse of the estimate's variance). With no items it returns the prior alone.
 */
function estimateAbility(items: { b: number; x: number }[]): { theta: number; info: number } {
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
  let info = PRIOR_INFO;
  for (const it of items) {
    const p = sigmoid(theta - it.b);
    info += p * (1 - p);
  }
  return { theta, info };
}

/**
 * Estimated scaled score from a flat pool of responses (all domains treated
 * equally). Returns null when there is no usable evidence. Prefer
 * `estimateWeightedScaledScore` for a section score — the digital SAT balances
 * domains, so a pooled estimate skews toward whatever you happened to practice.
 */
export function estimateScaledScore(responses: ScoredResponse[]): ScaledScoreEstimate | null {
  const items = toItems(responses);
  if (items.length === 0) return null;
  const { theta, info } = estimateAbility(items);
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

export interface DomainResponses {
  domain: string;
  /** Official SAT share of this domain (need not be pre-normalized). */
  weight: number;
  responses: ScoredResponse[];
}

export interface WeightedScaledScoreEstimate extends ScaledScoreEstimate {
  /** Domains with at least one usable response / total domains supplied. */
  domainsCovered: number;
  domainsTotal: number;
  /** Per-domain breakdown so the UI can show what fed the composite. */
  perDomain: { domain: string; score: number; weight: number; sampleSize: number }[];
}

/**
 * Estimated R&W section score that mirrors the SAT's domain balance: ability is
 * estimated separately within each domain, then combined as a weighted average
 * of the per-domain abilities using each domain's official share. This stops the
 * score from being lopsided when practice is uneven — 200 questions of
 * Information & Ideas and none of Conventions no longer reads as a full section
 * score of one domain's strength.
 *
 * Only domains that have responses contribute; their weights are renormalized to
 * sum to 1, so the composite is always a proper section-style average of what
 * has been practiced. `domainsCovered` lets the UI flag partial coverage. The
 * band combines the per-domain variances (Var(Σ wᵢθᵢ) = Σ wᵢ²·Var(θᵢ)), so it
 * widens when a heavily-weighted domain has thin data. Returns null with no
 * usable evidence in any domain.
 */
export function estimateWeightedScaledScore(groups: DomainResponses[]): WeightedScaledScoreEstimate | null {
  const present = groups
    .map((g) => ({ domain: g.domain, weight: g.weight, items: toItems(g.responses) }))
    .filter((g) => g.items.length > 0);
  if (present.length === 0) return null;

  const totalWeight = present.reduce((s, g) => s + g.weight, 0);
  let theta = 0;
  let variance = 0;
  let sampleSize = 0;
  const perDomain: WeightedScaledScoreEstimate['perDomain'] = [];

  for (const g of present) {
    const { theta: t, info } = estimateAbility(g.items);
    const w = g.weight / totalWeight; // renormalized official share
    theta += w * t;
    variance += w * w * (1 / info);
    sampleSize += g.items.length;
    perDomain.push({ domain: g.domain, score: thetaToScore(t), weight: w, sampleSize: g.items.length });
  }

  const standardError = Math.sqrt(variance);
  return {
    score: thetaToScore(theta),
    low: thetaToScore(theta - 1.96 * standardError),
    high: thetaToScore(theta + 1.96 * standardError),
    theta,
    standardError,
    sampleSize,
    domainsCovered: present.length,
    domainsTotal: groups.length,
    perDomain,
  };
}
