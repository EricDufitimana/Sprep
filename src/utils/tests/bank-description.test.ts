import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeQuestions, type DescribableQuestion } from '../bank-description.ts';

const q = (domain: string | null, difficulty: string | null = null): DescribableQuestion => ({
  domain,
  difficulty,
});

const II = 'information_and_ideas';
const CS = 'craft_and_structure';
const EI = 'expression_of_ideas';
const SEC = 'standard_english_conventions';

describe('describeQuestions', () => {
  it('returns an empty string for no questions', () => {
    assert.equal(describeQuestions([]), '');
  });

  it('names a single domain', () => {
    assert.equal(describeQuestions([q(CS), q(CS), q(CS)]), 'Craft & Structure');
  });

  it('joins exactly two domains with "and"', () => {
    const out = describeQuestions([q(II), q(II), q(CS)]);
    assert.equal(out, 'Information & Ideas and Craft & Structure');
  });

  it('names the top two when they dominate a wider spread', () => {
    // 8 of 10 in the top two → specific enough to name.
    const qs = [...Array(5)].map(() => q(II))
      .concat([...Array(3)].map(() => q(CS)))
      .concat([q(EI), q(SEC)]);
    assert.equal(describeQuestions(qs), 'Information & Ideas and Craft & Structure');
  });

  it('falls back to "Mixed domains" when the spread is even', () => {
    const qs = [q(II), q(II), q(CS), q(CS), q(EI), q(EI), q(SEC), q(SEC)];
    assert.equal(describeQuestions(qs), 'Mixed domains');
  });

  it('adds a difficulty skew when one dominates', () => {
    const qs = [q(CS, 'hard'), q(CS, 'hard'), q(CS, 'hard'), q(CS, 'easy')];
    assert.equal(describeQuestions(qs), 'Craft & Structure · mostly hard');
  });

  it('says "all" when every question shares a difficulty', () => {
    const qs = [q(CS, 'medium'), q(CS, 'medium')];
    assert.equal(describeQuestions(qs), 'Craft & Structure · all medium');
  });

  it('omits difficulty when no level dominates', () => {
    const qs = [q(CS, 'easy'), q(CS, 'medium'), q(CS, 'hard')];
    assert.equal(describeQuestions(qs), 'Craft & Structure');
  });

  it('ignores null domains and difficulties', () => {
    const qs = [q(null, null), q(CS, null), q(CS, null)];
    assert.equal(describeQuestions(qs), 'Craft & Structure');
  });

  it('produces nothing when every field is null', () => {
    assert.equal(describeQuestions([q(null), q(null)]), '');
  });

  it('stays short — never longer than a card line', () => {
    const qs = [...Array(30)].map(() => q(SEC, 'medium'));
    assert.ok(describeQuestions(qs).length < 60, describeQuestions(qs));
  });
});
