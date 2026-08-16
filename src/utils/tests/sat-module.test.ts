import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderLikeExam, rwSkillRank, selectExamModule, type PoolItem } from '../sat-module.ts';

/** Build a pool of `n` items in one domain/difficulty, ids prefixed for clarity. */
function make(
  domain: string,
  difficulty: string,
  n: number,
  opts: { format?: string; startPos?: number; skill?: string } = {},
): PoolItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${domain}-${difficulty}-${i}`,
    domain,
    skill: opts.skill ?? null,
    difficulty,
    position: (opts.startPos ?? 0) + i,
    answer_format: opts.format ?? 'mcq',
  }));
}

const RW_DOMAINS = [
  'craft_and_structure',
  'information_and_ideas',
  'standard_english_conventions',
  'expression_of_ideas',
];

describe('selectExamModule — Reading & Writing', () => {
  it('draws the official 27-question domain mix (8/7/7/5)', () => {
    const pool = RW_DOMAINS.flatMap((d) => make(d, 'hard', 20));
    const mod = selectExamModule(pool, 'reading_writing', 27);

    assert.equal(mod.total, 27);
    assert.equal(mod.orderedIds.length, 27);
    assert.equal(mod.plan.craft_and_structure, 8);
    assert.equal(mod.plan.information_and_ideas, 7);
    assert.equal(mod.plan.standard_english_conventions, 7);
    assert.equal(mod.plan.expression_of_ideas, 5);
  });

  it('lays domains out in real module-block order', () => {
    const pool = RW_DOMAINS.flatMap((d) => make(d, 'medium', 20));
    const mod = selectExamModule(pool, 'reading_writing', 27);

    const domainOf = (id: string) => id.split('-').slice(0, -2).join('_');
    const seq = mod.orderedIds.map(domainOf);
    // Every craft block precedes every information block, etc.
    const firstIdx = (d: string) => seq.indexOf(d);
    const lastIdx = (d: string) => seq.lastIndexOf(d);
    assert.ok(lastIdx('craft_and_structure') < firstIdx('information_and_ideas'));
    assert.ok(lastIdx('information_and_ideas') < firstIdx('standard_english_conventions'));
    assert.ok(lastIdx('standard_english_conventions') < firstIdx('expression_of_ideas'));
  });

  it('does not ask for more than the pool holds', () => {
    const pool = make('craft_and_structure', 'hard', 3);
    const mod = selectExamModule(pool, 'reading_writing', 27);
    assert.equal(mod.total, 3);
    assert.ok(mod.notes.length > 0);
  });

  it('orders skills within a domain the way a real module does', () => {
    // Deliberately shuffled input, with the bank's real spelling variants.
    const pool = [
      ...make('craft_and_structure', 'medium', 1, { skill: 'Cross-Text Connections' }),
      ...make('craft_and_structure', 'medium', 1, { skill: 'Text Structure & Purpose' }),
      ...make('craft_and_structure', 'medium', 1, { skill: 'Words in Context' }),
    ];
    const ordered = orderLikeExam(pool, 'reading_writing').map((q) => q.skill);
    assert.deepEqual(ordered, [
      'Words in Context',
      'Text Structure & Purpose',
      'Cross-Text Connections',
    ]);
  });

  it('sequences Information & Ideas: central → evidence(textual→quant) → inferences', () => {
    const pool = [
      ...make('information_and_ideas', 'medium', 1, { skill: 'Inferences' }),
      ...make('information_and_ideas', 'medium', 1, { skill: 'Command of Evidence (Quantitative)' }),
      ...make('information_and_ideas', 'medium', 1, { skill: 'Command of Evidence (Textual)' }),
      ...make('information_and_ideas', 'medium', 1, { skill: 'Central Ideas & Details' }),
    ];
    const ordered = orderLikeExam(pool, 'reading_writing').map((q) => q.skill);
    assert.deepEqual(ordered, [
      'Central Ideas & Details',
      'Command of Evidence (Textual)',
      'Command of Evidence (Quantitative)',
      'Inferences',
    ]);
  });
});

describe('rwSkillRank', () => {
  it('is stable across spelling variants of the same skill', () => {
    assert.equal(
      rwSkillRank('standard_english_conventions', 'Form, Structure & Sense'),
      rwSkillRank('standard_english_conventions', 'Form, Structure, and Sense (Dangling Modifiers)'),
    );
    assert.ok(
      rwSkillRank('standard_english_conventions', 'Boundaries') <
        rwSkillRank('standard_english_conventions', 'Form, Structure & Sense'),
    );
  });
});

describe('orderLikeExam — Math', () => {
  it('orders by ascending difficulty, grid-ins trailing MCQ in a tier', () => {
    const pool = [
      ...make('algebra', 'hard', 1, { startPos: 5 }),
      ...make('geometry_trigonometry', 'easy', 1, { format: 'spr', startPos: 1 }),
      ...make('algebra', 'easy', 1, { startPos: 0 }),
      ...make('advanced_math', 'medium', 1, { startPos: 3 }),
    ];
    const ordered = orderLikeExam(pool, 'math').map((q) => q.difficulty);
    assert.deepEqual(ordered, ['easy', 'easy', 'medium', 'hard']);

    // Within the easy tier, the MCQ comes before the grid-in.
    const easy = orderLikeExam(pool, 'math')
      .filter((q) => q.difficulty === 'easy')
      .map((q) => q.answer_format);
    assert.deepEqual(easy, ['mcq', 'spr']);
  });
});
