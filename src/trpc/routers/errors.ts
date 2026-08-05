import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { fetchAllRows } from '@/utils/paginate';
import { sectionSchema, questionDomainSchema, questionDifficultySchema } from '@/lib/validation';
import { domainOrderFor } from '@/lib/dsat';

/**
 * The Error Log — every question the user has answered incorrectly, so they can
 * review their mistakes, see what they picked vs. the right answer, and drill in
 * by domain/skill/difficulty. Unlike the browse flow this DELIBERATELY returns
 * correct_answer + explanation: the user has already attempted (and missed) each
 * one, so there is nothing left to protect — this is review, like bank editing.
 *
 * "Mastered" = the user's most recent graded attempt at that question was
 * correct; "unmastered" = their latest attempt was still wrong. This lets the
 * log double as a worklist: keep grinding the unmastered ones until they flip.
 */

/** One graded attempt joined to just enough of its question to bucket it. */
type GradedRow = {
  question_id: string;
  is_correct: boolean | null;
  selected_answer: string | null;
  flagged: boolean | null;
  self_diagnosis: string | null;
  time_spent_ms: number | null;
  answered_at: string | null;
  questions: {
    id: string;
    section: string | null;
    domain: string | null;
    skill: string | null;
    difficulty: string | null;
  } | null;
};

/** Per-question rollup of a user's attempt history. */
interface Agg {
  questionId: string;
  domain: string | null;
  skill: string | null;
  difficulty: string | null;
  attempts: number;
  wrongCount: number;
  correctCount: number;
  everCorrect: boolean;
  mastered: boolean; // most recent graded attempt was correct
  firstWrongAt: string | null;
  lastWrongAt: string | null;
  lastAttemptAt: string | null;
  lastWrongAnswer: string | null;
  flagged: boolean;
  selfDiagnosis: string | null;
  avgTimeMs: number | null;
}

/** Timestamp helper: nulls sort oldest so a real date always wins "latest". */
function ts(iso: string | null): number {
  if (!iso) return -Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

export const errorsRouter = createTRPCRouter({
  /**
   * The whole Error Log page in one round trip: a filtered, sorted list of
   * missed questions (with full review data) plus section-wide breakdown stats
   * that drive the filter rail. Stats are computed over the UNFILTERED failed
   * set so the sidebar always shows the full picture; only `items` narrows.
   */
  log: protectedProcedure
    .input(
      z
        .object({
          section: sectionSchema.default('reading_writing'),
          domain: questionDomainSchema.optional(),
          skill: z.string().max(120).optional(),
          difficulty: z.array(questionDifficultySchema).optional(),
          status: z.enum(['all', 'unmastered', 'mastered']).default('all'),
          flaggedOnly: z.boolean().default(false),
          search: z.string().max(160).optional(),
          sort: z.enum(['recent', 'most_missed', 'difficulty']).default('recent'),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { supabase } = ctx;
      const section = input?.section ?? 'reading_writing';

      // Every GRADED attempt (a real pick that was scored) from any mode — bank
      // practice and sittings alike — joined to just enough of its question to
      // bucket it. Section is filtered in JS (the proven pattern in progress.ts),
      // not on the embedded resource.
      let rows: GradedRow[];
      try {
        rows = await fetchAllRows<GradedRow>(
          (from, to) =>
            supabase
              .from('answers')
              .select(
                'question_id, is_correct, selected_answer, flagged, self_diagnosis, time_spent_ms, answered_at, questions ( id, section, domain, skill, difficulty )',
              )
              .not('is_correct', 'is', null)
              .not('selected_answer', 'is', null)
              .order('id', { ascending: true })
              .range(from, to) as unknown as PromiseLike<{ data: GradedRow[] | null; error: unknown }>,
        );
      } catch (error) {
        console.error('❌ [errors.log] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your error log' });
      }

      // ── Roll every attempt up to its question ──────────────────────────────
      const byQuestion = new Map<string, Agg & { _timeSum: number; _timeCount: number }>();
      for (const r of rows) {
        const q = r.questions;
        if (!q || q.section !== section) continue; // scope to the chosen section
        const correct = r.is_correct === true;
        let a = byQuestion.get(r.question_id);
        if (!a) {
          a = {
            questionId: r.question_id,
            domain: q.domain,
            skill: q.skill,
            difficulty: q.difficulty,
            attempts: 0,
            wrongCount: 0,
            correctCount: 0,
            everCorrect: false,
            mastered: false,
            firstWrongAt: null,
            lastWrongAt: null,
            lastAttemptAt: null,
            lastWrongAnswer: null,
            flagged: false,
            selfDiagnosis: null,
            avgTimeMs: null,
            _timeSum: 0,
            _timeCount: 0,
          };
          byQuestion.set(r.question_id, a);
        }
        a.attempts += 1;
        if (correct) a.correctCount += 1;
        else a.wrongCount += 1;
        a.everCorrect = a.everCorrect || correct;
        if (r.flagged) a.flagged = true;
        if (typeof r.time_spent_ms === 'number' && r.time_spent_ms > 0) {
          a._timeSum += r.time_spent_ms;
          a._timeCount += 1;
        }
        // Track the most recent attempt to decide mastery + carry its diagnosis.
        if (ts(r.answered_at) >= ts(a.lastAttemptAt)) {
          a.lastAttemptAt = r.answered_at;
          a.mastered = correct;
          if (r.self_diagnosis) a.selfDiagnosis = r.self_diagnosis;
        }
        if (!correct) {
          if (a.firstWrongAt === null || ts(r.answered_at) < ts(a.firstWrongAt)) a.firstWrongAt = r.answered_at;
          if (ts(r.answered_at) >= ts(a.lastWrongAt)) {
            a.lastWrongAt = r.answered_at;
            a.lastWrongAnswer = r.selected_answer;
          }
        }
      }

      // Only questions the user has actually missed at least once belong here.
      const failed: Agg[] = [];
      for (const a of Array.from(byQuestion.values())) {
        if (a.wrongCount > 0) {
          a.avgTimeMs = a._timeCount > 0 ? Math.round(a._timeSum / a._timeCount) : null;
          failed.push(a);
        }
      }

      // ── Section-wide stats (over the UNFILTERED failed set) ────────────────
      const domainStats = new Map<string, { total: number; unmastered: number }>();
      const skillStats = new Map<string, { domain: string; skill: string; total: number; unmastered: number }>();
      const diffStats = new Map<string, number>();
      let flaggedCount = 0;
      let masteredCount = 0;
      for (const a of failed) {
        if (a.flagged) flaggedCount += 1;
        if (a.mastered) masteredCount += 1;
        if (a.domain) {
          const d = domainStats.get(a.domain) ?? { total: 0, unmastered: 0 };
          d.total += 1;
          if (!a.mastered) d.unmastered += 1;
          domainStats.set(a.domain, d);
        }
        if (a.domain && a.skill) {
          const key = `${a.domain}::${a.skill}`;
          const s = skillStats.get(key) ?? { domain: a.domain, skill: a.skill, total: 0, unmastered: 0 };
          s.total += 1;
          if (!a.mastered) s.unmastered += 1;
          skillStats.set(key, s);
        }
        if (a.difficulty) diffStats.set(a.difficulty, (diffStats.get(a.difficulty) ?? 0) + 1);
      }

      const order = domainOrderFor(section);
      const stats = {
        totalFailed: failed.length,
        unmastered: failed.length - masteredCount,
        mastered: masteredCount,
        flagged: flaggedCount,
        byDomain: order
          .map((domain) => ({ domain, ...(domainStats.get(domain) ?? { total: 0, unmastered: 0 }) }))
          .filter((d) => d.total > 0),
        bySkill: Array.from(skillStats.values()).sort(
          (a, b) => b.unmastered - a.unmastered || b.total - a.total,
        ),
        byDifficulty: (['easy', 'medium', 'hard'] as const).map((difficulty) => ({
          difficulty,
          total: diffStats.get(difficulty) ?? 0,
        })),
      };

      // ── Apply the (non-search) filters ─────────────────────────────────────
      const diffSet = input?.difficulty?.length ? new Set(input.difficulty) : null;
      let filtered = failed.filter((a) => {
        if (input?.domain && a.domain !== input.domain) return false;
        if (input?.skill && a.skill !== input.skill) return false;
        if (diffSet && (!a.difficulty || !diffSet.has(a.difficulty as never))) return false;
        if (input?.status === 'unmastered' && a.mastered) return false;
        if (input?.status === 'mastered' && !a.mastered) return false;
        if (input?.flaggedOnly && !a.flagged) return false;
        return true;
      });

      // ── Fetch full review data only for the questions that survived ─────────
      const ids = filtered.map((a) => a.questionId);
      let details = new Map<string, Record<string, unknown>>();
      if (ids.length) {
        const detailRows = await fetchAllRows<Record<string, unknown>>((from, to) =>
          supabase
            .from('questions')
            .select(
              'id, external_id, section, domain, skill, difficulty, passage, question_text, options, correct_answer, explanation, has_visual, visual_data, visual_url, answer_format, accepted_answers, release_batch',
            )
            .in('id', ids)
            .order('id', { ascending: true })
            .range(from, to),
        );
        details = new Map(detailRows.map((d) => [d.id as string, d]));
      }

      // Search filters on the actual question/passage text, so it needs details.
      const term = input?.search?.trim().toLowerCase();
      if (term) {
        filtered = filtered.filter((a) => {
          const d = details.get(a.questionId);
          if (!d) return false;
          const hay = `${(d.question_text as string) ?? ''} ${(d.passage as string) ?? ''} ${(d.skill as string) ?? ''}`.toLowerCase();
          return hay.includes(term);
        });
      }

      // ── Merge + sort ───────────────────────────────────────────────────────
      const DIFF_RANK: Record<string, number> = { hard: 0, medium: 1, easy: 2 };
      const items = filtered
        .map((a) => {
          const d = details.get(a.questionId);
          if (!d) return null;
          const correctDisplay =
            d.answer_format === 'spr' && Array.isArray(d.accepted_answers)
              ? (d.accepted_answers as unknown[]).map(String).join(', ')
              : (d.correct_answer as string);
          return {
            ...a,
            _timeSum: undefined,
            _timeCount: undefined,
            section: (d.section as string) ?? null,
            externalId: (d.external_id as string) ?? null,
            releaseBatch: (d.release_batch as string) ?? null,
            passage: (d.passage as string) ?? null,
            questionText: (d.question_text as string) ?? '',
            options: d.options ?? [],
            correctAnswer: correctDisplay,
            explanation: (d.explanation as string) ?? null,
            hasVisual: Boolean(d.has_visual),
            visualData: (d.visual_data as string) ?? null,
            visualUrl: (d.visual_url as string) ?? null,
            answerFormat: (d.answer_format as string) ?? 'mcq',
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      items.sort((a, b) => {
        if (input?.sort === 'most_missed') return b.wrongCount - a.wrongCount || ts(b.lastWrongAt) - ts(a.lastWrongAt);
        if (input?.sort === 'difficulty')
          return (
            (DIFF_RANK[a.difficulty ?? 'easy'] ?? 3) - (DIFF_RANK[b.difficulty ?? 'easy'] ?? 3) ||
            ts(b.lastWrongAt) - ts(a.lastWrongAt)
          );
        return ts(b.lastWrongAt) - ts(a.lastWrongAt); // 'recent'
      });

      return { section, stats, items, shown: items.length };
    }),

  /**
   * Flag / unflag a question for review from the Error Log. Flag is conceptually
   * per (user, question), so it's written to every one of the user's answer rows
   * for that question; RLS keeps it scoped to the caller.
   */
  setFlag: protectedProcedure
    .input(z.object({ questionId: z.string().uuid(), flagged: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from('answers')
        .update({ flagged: input.flagged })
        .eq('question_id', input.questionId)
        .eq('user_id', ctx.user.id);
      if (error) {
        console.error('❌ [errors.setFlag] Update failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not update the flag' });
      }
      return { success: true, flagged: input.flagged };
    }),
});
