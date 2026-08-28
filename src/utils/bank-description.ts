/**
 * Build a one-line description for a question bank from its contents.
 *
 * Used when a bank is created from a PDF and the user didn't type one — an
 * empty description leaves a hole in the card. Deliberately terse: the card
 * already shows the question count, so this only says what's *in* the bank.
 *
 * Shape: "<dominant domains> · mostly <difficulty>"
 *   e.g. "Information & Ideas and Craft & Structure · mostly medium"
 *        "Craft & Structure"
 *
 * Pure — no I/O, no DB. Unit-tested in utils/tests/bank-description.test.ts.
 */

const DOMAIN_LABELS: Record<string, string> = {
  // Reading & Writing
  information_and_ideas: 'Information & Ideas',
  craft_and_structure: 'Craft & Structure',
  expression_of_ideas: 'Expression of Ideas',
  standard_english_conventions: 'Standard English Conventions',
  // Math
  algebra: 'Algebra',
  advanced_math: 'Advanced Math',
  problem_solving_data_analysis: 'Problem-Solving & Data Analysis',
  geometry_trigonometry: 'Geometry & Trigonometry',
};

export interface DescribableQuestion {
  domain?: string | null;
  difficulty?: string | null;
}

/** Counts by key, most frequent first. Nulls are ignored. */
function rank(values: (string | null | undefined)[]): { key: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export function describeQuestions(questions: DescribableQuestion[]): string {
  if (questions.length === 0) return '';

  const domains = rank(questions.map((q) => q.domain));
  const difficulties = rank(questions.map((q) => q.difficulty));

  const parts: string[] = [];

  if (domains.length > 0) {
    // Name at most two domains — beyond that it's just a list of everything,
    // which says nothing. "Mixed" is more honest and shorter.
    const covered = domains.slice(0, 2).reduce((s, d) => s + d.n, 0);
    const majority = covered / questions.length >= 0.7;

    if (domains.length <= 2 || majority) {
      const named = domains.slice(0, 2).map((d) => DOMAIN_LABELS[d.key] ?? d.key);
      parts.push(named.length === 2 ? `${named[0]} and ${named[1]}` : named[0]);
    } else {
      parts.push('Mixed domains');
    }
  }

  if (difficulties.length > 0) {
    const top = difficulties[0];
    // Only claim a skew when one difficulty actually dominates.
    if (top.n / questions.length >= 0.5) {
      parts.push(difficulties.length === 1 ? `all ${top.key}` : `mostly ${top.key}`);
    }
  }

  return parts.join(' · ');
}
