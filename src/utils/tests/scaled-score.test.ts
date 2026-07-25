import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateScaledScore,
  thetaToScore,
  SCORE_MIN,
  SCORE_MAX,
  type Difficulty,
  type ScoredResponse,
} from '../scaled-score.ts';

/**
 * Run with:  node --test --experimental-strip-types "src/utils/tests/*.test.ts"
 */

const resp = (difficulty: Difficulty | null, isCorrect: boolean): ScoredResponse => ({
  difficulty,
  isCorrect,
});

/** n responses of one difficulty, `correct` of them right. */
const batch = (difficulty: Difficulty, n: number, correct: number): ScoredResponse[] =>
  Array.from({ length: n }, (_, i) => resp(difficulty, i < correct));

describe('thetaToScore', () => {
  it('centres θ=0 at 500 and scales ~100 points per logit', () => {
    assert.equal(thetaToScore(0), 500);
    assert.equal(thetaToScore(1), 600);
    assert.equal(thetaToScore(-1), 400);
  });

  it('clamps and rounds to the 200–800 scale', () => {
    assert.equal(thetaToScore(5), SCORE_MAX);
    assert.equal(thetaToScore(-5), SCORE_MIN);
    assert.equal(thetaToScore(0.123), 510); // rounds to nearest 10
  });
});

describe('estimateScaledScore', () => {
  it('returns null with no usable evidence', () => {
    assert.equal(estimateScaledScore([]), null);
    assert.equal(estimateScaledScore([resp(null, true), resp(null, false)]), null);
  });

  it('ignores responses with an unknown difficulty', () => {
    const est = estimateScaledScore([...batch('medium', 4, 3), resp(null, false)]);
    assert.equal(est?.sampleSize, 4);
  });

  it('rewards the same accuracy more when the questions are harder', () => {
    // 8/10 correct at each difficulty level → strictly increasing scaled score.
    const easy = estimateScaledScore(batch('easy', 10, 8))!;
    const medium = estimateScaledScore(batch('medium', 10, 8))!;
    const hard = estimateScaledScore(batch('hard', 10, 8))!;

    assert.ok(easy.score < medium.score, `easy ${easy.score} < medium ${medium.score}`);
    assert.ok(medium.score < hard.score, `medium ${medium.score} < hard ${hard.score}`);
  });

  it('places a solid all-medium performer in a sensible mid-range band', () => {
    const est = estimateScaledScore(batch('medium', 20, 16))!; // 80% on medium
    assert.ok(est.score >= 560 && est.score <= 660, `got ${est.score}`);
    assert.ok(est.low < est.score && est.score < est.high, 'band brackets the estimate');
  });

  it('handles a perfect run without blowing up to infinity', () => {
    const est = estimateScaledScore(batch('hard', 15, 15))!;
    assert.ok(Number.isFinite(est.theta), 'theta is finite');
    assert.ok(est.score <= SCORE_MAX && est.score > 700, `got ${est.score}`);
  });

  it('handles an all-wrong run without diverging', () => {
    const est = estimateScaledScore(batch('easy', 15, 0))!;
    assert.ok(Number.isFinite(est.theta), 'theta is finite');
    assert.ok(est.score >= SCORE_MIN && est.score < 400, `got ${est.score}`);
  });

  it('gives a wide band on little evidence and a tighter one on more', () => {
    const few = estimateScaledScore(batch('medium', 3, 2))!;
    const many = estimateScaledScore(batch('medium', 40, 27))!; // ~same ratio
    const fewWidth = few.high - few.low;
    const manyWidth = many.high - many.low;
    assert.ok(manyWidth < fewWidth, `more evidence should tighten band: ${manyWidth} < ${fewWidth}`);
  });

  it('shrinks a tiny sample toward the mean (no false 800 from 3 lucky answers)', () => {
    const est = estimateScaledScore(batch('medium', 3, 3))!;
    assert.ok(est.score < 800, `three lucky mediums should not read as 800: ${est.score}`);
  });

  it('is monotonic in the number correct at fixed difficulty and count', () => {
    let prev = -Infinity;
    for (let correct = 0; correct <= 10; correct++) {
      const est = estimateScaledScore(batch('medium', 10, correct))!;
      assert.ok(est.score >= prev, `score should not decrease as correct rises (${correct})`);
      prev = est.score;
    }
  });
});
