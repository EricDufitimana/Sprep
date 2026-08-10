import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcile,
  statedAnswer,
  buildAcceptedAnswers,
} from '../../../scripts/lib/spr-answer-reconcile.mjs';
import { isResponseCorrect } from '../scoring.ts';

/**
 * Guards the SPR-answer reconciler used by the ingest guard, the audit script,
 * and the truncated-answer migration. The real-world bug it prevents: a grid-in
 * answer stored as the integer truncation of its true value ("1" for "1.5").
 *
 * Run with:  node --test --experimental-strip-types "src/utils/tests/*.test.ts"
 */

describe('statedAnswer', () => {
  it('extracts a clean decimal from the explanation', () => {
    assert.deepEqual(statedAnswer('<p>The correct answer is 1.5. The point…</p>'), {
      token: '1.5',
      value: 1.5,
    });
  });

  it('does not misread an imaged fraction as a bare integer', () => {
    // "the correct answer is <img>1</img>/<img>4</img>" strips to "…is █ / █".
    assert.equal(statedAnswer('The correct answer is <img src="a">/<img src="b">.'), null);
  });
});

describe('reconcile', () => {
  it('flags a truncated answer as auto-fixable', () => {
    const v = reconcile(['1'], '<p>The correct answer is 1.5. …</p>');
    assert.equal(v.status, 'truncated');
    assert.equal(v.correct, '1.5');
  });

  it('accepts a correct multi-form answer', () => {
    assert.equal(reconcile(['25.4', '127/5'], 'The correct answer is 25.4.').status, 'ok');
  });

  it('treats a half-imaged fraction whose numerator matches a stored fraction as ok', () => {
    // stored 1/4 is right; explanation shows "is <img>1</img>/<img>4</img>",
    // and a lenient reader could pull "1" — must not be called a mismatch.
    assert.equal(reconcile(['0.25', '1/4'], 'The correct answer is 1 4 .').status, 'ok');
  });

  it('reports a genuine disagreement as mismatch, never truncated', () => {
    const v = reconcile(['7'], 'The correct answer is 9.');
    assert.equal(v.status, 'mismatch');
  });

  it('says nothing when the explanation states no clean number', () => {
    assert.equal(reconcile(['1/4'], 'See the worked solution above.').status, 'no_stated_answer');
  });
});

describe('buildAcceptedAnswers', () => {
  it('pairs a terminating decimal with its reduced fraction', () => {
    assert.deepEqual(buildAcceptedAnswers('1.5'), ['1.5', '3/2']);
    assert.deepEqual(buildAcceptedAnswers('25.4'), ['25.4', '127/5']);
    assert.deepEqual(buildAcceptedAnswers('4.5'), ['4.5', '9/2']);
  });

  it('leaves an integer answer as a single form', () => {
    assert.deepEqual(buildAcceptedAnswers('7'), ['7']);
  });
});

describe('corrected answers grade correctly end-to-end', () => {
  const corrected = buildAcceptedAnswers('1.5'); // ['1.5', '3/2']
  const question = {
    id: 'q',
    domain: null,
    skill: null,
    correct_answer: corrected[0],
    answer_format: 'spr',
    accepted_answers: corrected,
  };

  for (const typed of ['1.5', '3/2', '1.50']) {
    it(`accepts a student who types "${typed}"`, () => {
      assert.equal(isResponseCorrect(question, typed), true);
    });
  }

  it('still rejects the old truncated value', () => {
    assert.equal(isResponseCorrect(question, '1'), false);
  });
});
