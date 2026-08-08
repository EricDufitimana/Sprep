/**
 * Pure scoring utilities — no I/O, no Supabase, no side effects.
 * Small and testable, matching how `utils/markdown.ts` / `utils/validateEmail.ts`
 * are structured in the CRC codebase.
 *
 * Everything here is called exactly once per attempt, inside `tests.submit`.
 * The values it returns are persisted as a permanent snapshot and are never
 * recomputed on read — see `tests.getResults`.
 */

export type AnswerLetter = 'A' | 'B' | 'C' | 'D';

export interface ScorableQuestion {
  id: string;
  domain: string | null;
  skill: string | null;
  correct_answer: string;
  /** 'mcq' (letter) | 'spr' (free-response). Absent ⇒ treated as MCQ. */
  answer_format?: string | null;
  /** SPR only: the list of accepted answers. */
  accepted_answers?: unknown;
}

export interface ScorableAnswer {
  question_id: string;
  selected_answer: string | null;
  flagged: boolean;
}

export interface GradedAnswer {
  question_id: string;
  selected_answer: string | null;
  is_correct: boolean;
  flagged: boolean;
}

export interface BreakdownRow {
  key: string;
  correct: number;
  total: number;
  accuracyPercent: number;
}

export interface ScoredAttempt {
  totalQuestions: number;
  correctCount: number;
  scorePercent: number;
  answeredCount: number;
  unansweredCount: number;
  flaggedCount: number;
  graded: GradedAnswer[];
  byDomain: BreakdownRow[];
  bySkill: BreakdownRow[];
}

/** Case- and whitespace-insensitive letter comparison. */
export function isAnswerCorrect(selected: string | null, correct: string): boolean {
  if (selected === null) return false;
  return selected.trim().toUpperCase() === correct.trim().toUpperCase();
}

/**
 * Parse an SAT student-response token to a number. Handles integers, decimals,
 * a leading `+`, thousands commas, `a/b` fractions, a trailing `%`, and a
 * leading `$`. Returns null for word forms — those are handled by
 * {@link wordFormToNumber}, and both feed {@link parseAnswerNumber}.
 */
export function normalizeNumericAnswer(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/,/g, '')
    .replace(/^\+/, '')
    .replace(/^\$/, '')
    .replace(/%$/, '');
  if (s === '') return null;
  const frac = /^(-?\d+)\/(-?\d+)$/.exec(s);
  if (frac) {
    const denom = Number(frac[2]);
    return denom === 0 ? null : Number(frac[1]) / denom;
  }
  if (/^-?\d*\.?\d+$/.test(s)) return Number(s);
  return null;
}

// Cardinal number words → value. `a`/`an` behave as 1 ("a half" = 1/2).
const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, a: 1, an: 1,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
// Denominator (fraction) words → denominator, singular and plural.
const DENOM: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4,
  fourth: 4, fourths: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6,
  seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9,
  tenth: 10, tenths: 10, eleventh: 11, elevenths: 11, twelfth: 12,
  twelfths: 12, sixteenth: 16, sixteenths: 16, twentieth: 20, twentieths: 20,
};

/** Parse a whole-number phrase ("twenty one", "one hundred") to a value. */
function parseCardinalPhrase(words: string[]): number | null {
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  let matched = false;
  for (const w of words) {
    if (w === 'and') continue;
    if (w in ONES) {
      current += ONES[w];
    } else if (w in TENS) {
      current += TENS[w];
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
    } else if (w === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else {
      return null; // an unrecognized word — not a pure cardinal phrase
    }
    matched = true;
  }
  return matched ? total + current : null;
}

/** Parse a fraction phrase ("one half", "three quarters", "half") to a value. */
function parseFractionPhrase(words: string[]): number | null {
  if (words.length === 0) return null;
  const denom = DENOM[words[words.length - 1]];
  if (!denom) return null;
  const numWords = words.slice(0, -1);
  const numerator = numWords.length === 0 ? 1 : parseCardinalPhrase(numWords);
  if (numerator === null) return null;
  return numerator / denom;
}

/**
 * Convert an English word-form number to its numeric value, or null if it isn't
 * one. Covers cardinals ("twenty one"), fraction words ("one half", "three
 * quarters", "half"), and mixed numbers ("one and a half"). This is what lets a
 * student's "1/2" match a stored "one half", and vice versa.
 */
export function wordFormToNumber(raw: string): number | null {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ');
  if (s === '') return null;

  // Mixed number: "<whole> and <fraction>" → whole + fraction.
  const andParts = s.split(' and ');
  if (andParts.length === 2) {
    const whole = parseCardinalPhrase(andParts[0].split(' ').filter(Boolean));
    const frac = parseFractionPhrase(andParts[1].split(' ').filter(Boolean));
    if (whole !== null && frac !== null) return whole + frac;
  }

  const words = s.split(' ').filter(Boolean);
  const frac = parseFractionPhrase(words);
  if (frac !== null) return frac;
  return parseCardinalPhrase(words);
}

/**
 * Parse any student/answer string to a number: strict numeric token first
 * (fractions, decimals, %, $), then English word forms. Central to grading —
 * every SPR comparison flows through it so equivalent representations
 * ("1/2", "0.5", ".5", "one half") all reduce to the same value.
 */
export function parseAnswerNumber(raw: string): number | null {
  const numeric = normalizeNumericAnswer(raw);
  if (numeric !== null) return numeric;
  return wordFormToNumber(raw);
}

/**
 * Grade any question. MCQ compares letters; SPR (free-response) accepts a
 * numeric match against any accepted answer — fractions, decimals, percents,
 * and English word forms are all reduced to a number and compared — falling
 * back to a case-insensitive literal match only when neither side is numeric.
 */
export function isResponseCorrect(q: ScorableQuestion, selected: string | null): boolean {
  if (selected === null || selected.trim() === '') return false;

  if (q.answer_format !== 'spr') {
    return isAnswerCorrect(selected, q.correct_answer);
  }

  const accepted: string[] = Array.isArray(q.accepted_answers) && q.accepted_answers.length > 0
    ? (q.accepted_answers as unknown[]).map(String)
    : [q.correct_answer];

  const selNum = parseAnswerNumber(selected);
  const selLiteral = selected.trim().replace(/\s+/g, ' ').toLowerCase();

  return accepted.some((a) => {
    const aNum = parseAnswerNumber(a);
    if (selNum !== null && aNum !== null) return Math.abs(selNum - aNum) < 1e-9;
    return a.trim().replace(/\s+/g, ' ').toLowerCase() === selLiteral;
  });
}

/** Percentage of `total`, rounded to one decimal. Zero questions scores 0. */
export function percent(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function breakdown(
  questions: ScorableQuestion[],
  graded: GradedAnswer[],
  pick: (q: ScorableQuestion) => string | null,
): BreakdownRow[] {
  const gradedById = new Map(graded.map((g) => [g.question_id, g]));
  const buckets = new Map<string, { correct: number; total: number }>();

  for (const q of questions) {
    const key = pick(q);
    if (key === null) continue;
    const bucket = buckets.get(key) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (gradedById.get(q.id)?.is_correct) bucket.correct += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([key, b]) => ({
      key,
      correct: b.correct,
      total: b.total,
      accuracyPercent: percent(b.correct, b.total),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Grade a whole attempt.
 *
 * Questions with no saved answer row count as unanswered and incorrect —
 * a blank is a miss, matching how the real test scores.
 */
export function scoreAttempt(
  questions: ScorableQuestion[],
  answers: ScorableAnswer[],
): ScoredAttempt {
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));

  const graded: GradedAnswer[] = questions.map((q) => {
    const a = answerByQuestion.get(q.id);
    const selected = a?.selected_answer ?? null;
    return {
      question_id: q.id,
      selected_answer: selected,
      is_correct: isResponseCorrect(q, selected),
      flagged: a?.flagged ?? false,
    };
  });

  const correctCount = graded.filter((g) => g.is_correct).length;
  const answeredCount = graded.filter((g) => g.selected_answer !== null).length;

  return {
    totalQuestions: questions.length,
    correctCount,
    scorePercent: percent(correctCount, questions.length),
    answeredCount,
    unansweredCount: questions.length - answeredCount,
    flaggedCount: graded.filter((g) => g.flagged).length,
    graded,
    byDomain: breakdown(questions, graded, (q) => q.domain),
    bySkill: breakdown(questions, graded, (q) => q.skill),
  };
}
