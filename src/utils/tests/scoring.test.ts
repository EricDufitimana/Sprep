import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnswerCorrect,
  percent,
  scoreAttempt,
  type ScorableAnswer,
  type ScorableQuestion,
} from '../scoring.ts';

/**
 * Run with:  node --test --experimental-strip-types "src/utils/tests/*.test.ts"
 * (also wired as `npm run test:scoring`)
 */

const q = (
  id: string,
  correct: string,
  domain: string | null = 'craft_and_structure',
  skill: string | null = 'Words in Context',
): ScorableQuestion => ({ id, domain, skill, correct_answer: correct });

const a = (
  question_id: string,
  selected_answer: string | null,
  flagged = false,
): ScorableAnswer => ({ question_id, selected_answer, flagged });

describe('isAnswerCorrect', () => {
  it('matches exactly', () => {
    assert.equal(isAnswerCorrect('B', 'B'), true);
    assert.equal(isAnswerCorrect('A', 'B'), false);
  });

  it('ignores case and surrounding whitespace', () => {
    assert.equal(isAnswerCorrect('b', 'B'), true);
    assert.equal(isAnswerCorrect(' C ', 'C'), true);
    assert.equal(isAnswerCorrect('d', ' D'), true);
  });

  it('treats a blank as incorrect, never as a match', () => {
    assert.equal(isAnswerCorrect(null, 'A'), false);
  });
});

describe('percent', () => {
  it('rounds to one decimal', () => {
    assert.equal(percent(1, 3), 33.3);
    assert.equal(percent(2, 3), 66.7);
  });

  it('handles the boundaries', () => {
    assert.equal(percent(0, 10), 0);
    assert.equal(percent(10, 10), 100);
  });

  it('returns 0 rather than dividing by zero', () => {
    assert.equal(percent(0, 0), 0);
    assert.equal(percent(5, 0), 0);
  });
});

describe('scoreAttempt', () => {
  it('scores a straightforward attempt', () => {
    const questions = [q('q1', 'A'), q('q2', 'B'), q('q3', 'C'), q('q4', 'D')];
    const answers = [a('q1', 'A'), a('q2', 'B'), a('q3', 'C'), a('q4', 'A')];

    const result = scoreAttempt(questions, answers);

    assert.equal(result.totalQuestions, 4);
    assert.equal(result.correctCount, 3);
    assert.equal(result.scorePercent, 75);
    assert.equal(result.answeredCount, 4);
    assert.equal(result.unansweredCount, 0);
  });

  it('counts a question with no answer row as unanswered and incorrect', () => {
    const questions = [q('q1', 'A'), q('q2', 'B'), q('q3', 'C')];
    // q3 never saved — the user ran out of time.
    const answers = [a('q1', 'A'), a('q2', 'B')];

    const result = scoreAttempt(questions, answers);

    assert.equal(result.correctCount, 2);
    assert.equal(result.answeredCount, 2);
    assert.equal(result.unansweredCount, 1);
    assert.equal(result.scorePercent, 66.7);

    const q3 = result.graded.find((g) => g.question_id === 'q3');
    assert.equal(q3?.is_correct, false);
    assert.equal(q3?.selected_answer, null);
  });

  it('counts an explicit null pick as unanswered', () => {
    const result = scoreAttempt([q('q1', 'A')], [a('q1', null)]);

    assert.equal(result.answeredCount, 0);
    assert.equal(result.unansweredCount, 1);
    assert.equal(result.correctCount, 0);
  });

  it('tallies flags independently of correctness', () => {
    const questions = [q('q1', 'A'), q('q2', 'B'), q('q3', 'C')];
    const answers = [a('q1', 'A', true), a('q2', 'D', true), a('q3', 'C', false)];

    const result = scoreAttempt(questions, answers);

    assert.equal(result.flaggedCount, 2);
    assert.equal(result.correctCount, 2);
  });

  it('breaks down by domain and by skill', () => {
    const questions = [
      q('q1', 'A', 'information_and_ideas', 'Inferences'),
      q('q2', 'B', 'information_and_ideas', 'Inferences'),
      q('q3', 'C', 'craft_and_structure', 'Words in Context'),
      q('q4', 'D', 'craft_and_structure', 'Words in Context'),
    ];
    const answers = [a('q1', 'A'), a('q2', 'X'), a('q3', 'C'), a('q4', 'D')];

    const result = scoreAttempt(questions, answers);

    const info = result.byDomain.find((d) => d.key === 'information_and_ideas');
    assert.deepEqual(
      { correct: info?.correct, total: info?.total, accuracyPercent: info?.accuracyPercent },
      { correct: 1, total: 2, accuracyPercent: 50 },
    );

    const craft = result.byDomain.find((d) => d.key === 'craft_and_structure');
    assert.equal(craft?.accuracyPercent, 100);

    const wic = result.bySkill.find((s) => s.key === 'Words in Context');
    assert.equal(wic?.total, 2);
    assert.equal(wic?.correct, 2);
  });

  it('omits questions with a null domain or skill from that breakdown', () => {
    const questions = [q('q1', 'A', null, null), q('q2', 'B', 'craft_and_structure', 'Transitions')];
    const answers = [a('q1', 'A'), a('q2', 'B')];

    const result = scoreAttempt(questions, answers);

    // Both still count toward the overall score.
    assert.equal(result.correctCount, 2);
    assert.equal(result.totalQuestions, 2);
    // But only the classified one appears in the breakdowns.
    assert.equal(result.byDomain.length, 1);
    assert.equal(result.bySkill.length, 1);
  });

  it('scores an empty attempt as 0 without dividing by zero', () => {
    const result = scoreAttempt([], []);

    assert.equal(result.totalQuestions, 0);
    assert.equal(result.scorePercent, 0);
    assert.equal(result.correctCount, 0);
    assert.deepEqual(result.byDomain, []);
  });

  it('ignores answer rows for questions not in the attempt', () => {
    const result = scoreAttempt([q('q1', 'A')], [a('q1', 'A'), a('ghost', 'B')]);

    assert.equal(result.totalQuestions, 1);
    assert.equal(result.graded.length, 1);
    assert.equal(result.correctCount, 1);
  });

  it('normalizes case when grading, matching isAnswerCorrect', () => {
    const result = scoreAttempt([q('q1', 'B')], [a('q1', 'b')]);
    assert.equal(result.correctCount, 1);
    assert.equal(result.scorePercent, 100);
  });
});
