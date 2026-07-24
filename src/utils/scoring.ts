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
      is_correct: isAnswerCorrect(selected, q.correct_answer),
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
