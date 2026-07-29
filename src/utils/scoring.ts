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
 * a leading `+`, thousands commas, and `a/b` fractions. Returns null for word
 * forms ("three halves") — those fall back to literal string matching.
 */
export function normalizeNumericAnswer(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '').replace(/^\+/, '');
  if (s === '') return null;
  const frac = /^(-?\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const denom = Number(frac[2]);
    return denom === 0 ? null : Number(frac[1]) / denom;
  }
  if (/^-?\d*\.?\d+$/.test(s)) return Number(s);
  return null;
}

/**
 * Grade any question. MCQ compares letters; SPR (free-response) accepts a
 * numeric match against any accepted answer (fractions/decimals equated), or a
 * case-insensitive literal match for word-form answers.
 */
export function isResponseCorrect(q: ScorableQuestion, selected: string | null): boolean {
  if (selected === null || selected.trim() === '') return false;

  if (q.answer_format !== 'spr') {
    return isAnswerCorrect(selected, q.correct_answer);
  }

  const accepted: string[] = Array.isArray(q.accepted_answers)
    ? (q.accepted_answers as unknown[]).map(String)
    : [q.correct_answer];

  const selNum = normalizeNumericAnswer(selected);
  const selLiteral = selected.trim().toLowerCase();

  return accepted.some((a) => {
    const aNum = normalizeNumericAnswer(a);
    if (selNum !== null && aNum !== null) return Math.abs(selNum - aNum) < 1e-9;
    return a.trim().toLowerCase() === selLiteral;
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
