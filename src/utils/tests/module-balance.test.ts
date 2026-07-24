import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { balanceCustom, balanceDsat, largestRemainder } from '../module-balance.ts';

const DSAT = {
  craft_and_structure: 0.28,
  information_and_ideas: 0.26,
  standard_english_conventions: 0.26,
  expression_of_ideas: 0.2,
};

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);

describe('largestRemainder', () => {
  it('sums to exactly the total', () => {
    for (const total of [1, 5, 8, 27, 54, 100]) {
      assert.equal(sum(largestRemainder(total, DSAT)), total, `total ${total}`);
    }
  });

  it('matches the official 27-question DSAT module split', () => {
    // 0.28→7.56, 0.26→7.02, 0.26→7.02, 0.20→5.40 ⇒ 8/7/7/5
    const r = largestRemainder(27, DSAT);
    assert.equal(r.craft_and_structure, 8);
    assert.equal(r.information_and_ideas, 7);
    assert.equal(r.standard_english_conventions, 7);
    assert.equal(r.expression_of_ideas, 5);
  });

  it('handles zero total and zero weights', () => {
    assert.equal(sum(largestRemainder(0, DSAT)), 0);
    assert.deepEqual(largestRemainder(10, { a: 0, b: 0 }), { a: 0, b: 0 });
  });
});

describe('balanceDsat', () => {
  it('produces the ideal split when content is plentiful', () => {
    const available = {
      craft_and_structure: 50,
      information_and_ideas: 50,
      standard_english_conventions: 50,
      expression_of_ideas: 50,
    };
    const r = balanceDsat(27, available, DSAT);
    assert.equal(r.total, 27);
    assert.ok(r.balanced);
    assert.equal(r.byDomain.craft_and_structure, 8);
    assert.equal(r.byDomain.expression_of_ideas, 5);
  });

  it('backfills to full length when one domain is short', () => {
    // Only Craft has few; the rest are deep.
    const available = {
      craft_and_structure: 2,
      information_and_ideas: 50,
      standard_english_conventions: 50,
      expression_of_ideas: 50,
    };
    const r = balanceDsat(27, available, DSAT);
    assert.equal(r.total, 27, 'still reaches full length');
    assert.equal(r.byDomain.craft_and_structure, 2, 'takes all available in the short domain');
    assert.ok(!r.balanced);
    assert.ok(r.notes.length > 0);
  });

  it('degrades to a single-domain module when that is all there is', () => {
    // Exactly the state of the seeded banks: 52 Information & Ideas, nothing else.
    const available = { information_and_ideas: 52 };
    const r = balanceDsat(27, available, DSAT);
    assert.equal(r.total, 27);
    assert.equal(r.byDomain.information_and_ideas, 27);
    assert.equal(Object.keys(r.byDomain).length, 1);
  });

  it('caps the total at the grand available count', () => {
    const available = { information_and_ideas: 10 };
    const r = balanceDsat(27, available, DSAT);
    assert.equal(r.total, 10);
    assert.ok(r.notes.some((n) => n.includes('Only 10')));
  });

  it('omits domains that contribute nothing', () => {
    const r = balanceDsat(27, { information_and_ideas: 52 }, DSAT);
    assert.equal(r.byDomain.craft_and_structure, undefined);
  });
});

describe('balanceCustom', () => {
  it('takes an explicit per-domain request literally', () => {
    const available = { information_and_ideas: 20, craft_and_structure: 20 };
    const r = balanceCustom({ information_and_ideas: 5, craft_and_structure: 3 }, available);
    assert.equal(r.total, 8);
    assert.equal(r.byDomain.information_and_ideas, 5);
    assert.equal(r.byDomain.craft_and_structure, 3);
    assert.ok(r.balanced);
  });

  it('caps at availability and reports the shortfall', () => {
    const r = balanceCustom({ information_and_ideas: 30 }, { information_and_ideas: 10 });
    assert.equal(r.byDomain.information_and_ideas, 10);
    assert.equal(r.total, 10);
    assert.ok(!r.balanced);
    assert.ok(r.notes[0].includes('10'));
  });

  it('ignores zero and negative requests', () => {
    const r = balanceCustom(
      { information_and_ideas: 0, craft_and_structure: -3 },
      { information_and_ideas: 10, craft_and_structure: 10 },
    );
    assert.equal(r.total, 0);
    assert.deepEqual(r.byDomain, {});
  });
});
