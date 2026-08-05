import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTRPCRouter, protectedProcedure } from '../init';
import { fetchAllRows } from '@/utils/paginate';
import {
  answerLetterSchema,
  answerValueSchema,
  extractionStatusSchema,
  questionDifficultySchema,
  questionDomainSchema,
  questionOptionsSchema,
  sectionSchema,
} from '@/lib/validation';
import { isResponseCorrect } from '@/utils/scoring';

/**
 * Which release cohort of the bank to draw from:
 *  - 'all'      — the whole pool (original + every new batch)
 *  - 'original' — only the original pool (release_batch IS NULL)
 *  - 'new'      — only questions from a Bluebook refresh (release_batch set)
 * This keeps newly-released questions viewable on their own instead of silently
 * mixed into the original pool. Applied at the query level so counts and the
 * set-builder draw from exactly the same scope. Each caller applies it inline
 * with `.is('release_batch', null)` / `.not('release_batch', 'is', null)`.
 */
const cohortSchema = z.enum(['all', 'original', 'new']).default('all');

/**
 * Reading and repairing individual questions, plus the untimed browse flow.
 *
 * Two kinds of procedure live here, with opposite answer-visibility rules:
 *
 *  - Bank review (`listByBank`, `get`, `updateReviewedQuestion`) legitimately
 *    returns `correct_answer` — the caller owns the bank and is editing it
 *    outside any sitting.
 *  - The browse flow (`domainCounts`, `buildCustomSet`, `check`) serves
 *    questions to *take*, so it honours the same invariant as the timed test:
 *    `buildCustomSet` selects only SAFE columns (no answer/explanation), and
 *    `check` is the single place that hands them back — one question at a
 *    time, on explicit user action, recording the attempt (with correctness
 *    and per-question time) in the unified `answers` table.
 */

/** Columns safe to send before a reveal — mirrors the timed-test invariant. */
const SAFE_QUESTION_COLUMNS =
  'id, external_id, position, passage, question_text, options, has_visual, visual_data, visual_url, domain, skill, difficulty, section, answer_format';

/**
 * PostgREST predicate for "this row is a real completion", shared by every
 * "already done" read. A bank/practice attempt (attempt_id null) always counts;
 * a sitting counts only once graded (is_correct written at submit) and actually
 * answered. In-progress sittings (is_correct null) are excluded.
 */
export const COMPLETED_ANSWER_FILTER =
  'attempt_id.is.null,and(is_correct.not.is.null,selected_answer.not.is.null)';

/**
 * Every question the caller has already completed, in any mode. Reads the
 * unified `answers` table (bank practice + sittings). RLS scopes to the user.
 */
async function completedIds(supabase: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAllRows<{ id: string; question_id: string }>((from, to) =>
    supabase
      .from('answers')
      .select('id, question_id')
      .or(COMPLETED_ANSWER_FILTER)
      .order('id', { ascending: true })
      .range(from, to),
  );
  return new Set(rows.map((r) => r.question_id));
}

/** Fisher–Yates — a custom set is genuinely randomised, not just sliced. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const questionsRouter = createTRPCRouter({
  listByBank: protectedProcedure
    .input(
      z.object({
        bankId: z.string().uuid(),
        status: extractionStatusSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from('questions')
        .select(`
          id, position, domain, skill, difficulty, passage, question_text,
          options, correct_answer, explanation, has_visual, visual_data,
          extraction_status, external_id, created_at
        `)
        .eq('bank_id', input.bankId)
        .order('position', { ascending: true, nullsFirst: false });

      if (input.status) query = query.eq('extraction_status', input.status);

      const { data, error } = await query;

      if (error) {
        console.error('❌ [questions.listByBank] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load questions' });
      }

      return data ?? [];
    }),

  get: protectedProcedure
    .input(z.object({ questionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('questions')
        .select(`
          id, bank_id, position, domain, skill, difficulty, passage, question_text,
          options, correct_answer, explanation, has_visual, visual_data,
          extraction_status, external_id, created_at
        `)
        .eq('id', input.questionId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
      }

      return data;
    }),

  /**
   * Approve or correct a question surfaced by extraction. This is the manual
   * step the pipeline is designed to minimise — only `needs_review` rows
   * should ever reach it.
   *
   * Promoting to `verified` re-syncs the bank's `total_questions`, since that
   * count drives how many questions a sitting can draw.
   */
  updateReviewedQuestion: protectedProcedure
    .input(
      z.object({
        questionId: z.string().uuid(),
        passage: z.string().nullable().optional(),
        question_text: z.string().min(1).optional(),
        options: questionOptionsSchema.optional(),
        correct_answer: answerLetterSchema.optional(),
        explanation: z.string().nullable().optional(),
        domain: questionDomainSchema.nullable().optional(),
        skill: z.string().nullable().optional(),
        difficulty: questionDifficultySchema.nullable().optional(),
        visual_data: z.string().nullable().optional(),
        extraction_status: extractionStatusSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase } = ctx;
      const { questionId, ...changes } = input;

      const { data: existing, error: loadError } = await supabase
        .from('questions')
        .select('id, bank_id, options, correct_answer')
        .eq('id', questionId)
        .single();

      if (loadError || !existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
      }

      // Guard the invariant the extractor also enforces: the correct answer
      // must exist among the options, whichever of the two is being changed.
      const nextOptions = changes.options ?? (existing.options as { letter: string }[]);
      const nextAnswer = changes.correct_answer ?? existing.correct_answer;
      if (Array.isArray(nextOptions) && !nextOptions.some((o) => o.letter === nextAnswer)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'correct_answer must match one of the option letters',
        });
      }

      const patch = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );

      if (Object.keys(patch).length === 0) {
        return { success: true, updated: false };
      }

      const { error } = await supabase.from('questions').update(patch).eq('id', questionId);

      if (error) {
        console.error('❌ [questions.updateReviewedQuestion] Update failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not update the question' });
      }

      if (changes.extraction_status) {
        const { count } = await supabase
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('bank_id', existing.bank_id)
          .eq('extraction_status', 'verified');

        await supabase
          .from('question_banks')
          .update({ total_questions: count ?? 0 })
          .eq('id', existing.bank_id);
      }

      return { success: true, updated: true };
    }),

  delete: protectedProcedure
    .input(z.object({ questionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('questions').delete().eq('id', input.questionId);

      if (error) {
        console.error('❌ [questions.delete] Delete failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the question' });
      }

      return { success: true };
    }),

  // ── Shared history + browse flow ────────────────────────────────────────────

  /**
   * The set of question ids the current user has completed in any mode. Both
   * the practice test-builder and the browse page read this to power an
   * "exclude questions I've already done" toggle.
   */
  getCompletedIds: protectedProcedure.query(async ({ ctx }) => {
    return Array.from(await completedIds(ctx.supabase));
  }),

  /**
   * Counts of verified questions per domain, and per skill within each domain,
   * across every bank the user can see (their own + built-ins, via RLS). Drives
   * the /question-bank drill-down. Honours an optional difficulty filter and
   * the same "exclude already done" set as the set-builder, so the numbers the
   * user sees match what a set would actually draw from.
   */
  domainCounts: protectedProcedure
    .input(
      z
        .object({
          section: sectionSchema.default('reading_writing'),
          difficulty: z.array(questionDifficultySchema).optional(),
          excludeCompleted: z.boolean().default(false),
          /** Drop questions still live in Bluebook (active = true). */
          excludeActive: z.boolean().default(false),
          /** Release cohort to count: all | original pool | newly-released batch. */
          cohort: cohortSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { supabase } = ctx;
      const section = input?.section ?? 'reading_writing';
      const cohort = input?.cohort ?? 'all';

      // Paged: the visible verified pool exceeds PostgREST's 1000-row cap, so a
      // single select would silently truncate and undercount whole domains.
      const makeQuery = (from: number, to: number) => {
        let q = supabase
          .from('questions')
          .select('id, domain, skill, active')
          .eq('extraction_status', 'verified')
          .eq('section', section)
          .order('id', { ascending: true });
        if (input?.difficulty?.length) q = q.in('difficulty', input.difficulty);
        // Keep the Original pool and each New batch on separate switches.
        if (cohort === 'original') q = q.is('release_batch', null);
        else if (cohort === 'new') q = q.not('release_batch', 'is', null);
        return q.range(from, to);
      };

      let rows: { id: string; domain: string | null; skill: string | null; active: boolean | null }[];
      try {
        rows = await fetchAllRows(makeQuery);
      } catch (error) {
        console.error('❌ [questions.domainCounts] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load counts' });
      }

      // Exclude everything except explicitly-disclosed official questions:
      // keep active === false, drop active === true (live in Bluebook) AND
      // active === null (questions from other banks, which have no CB status).
      if (input?.excludeActive) {
        rows = rows.filter((r) => r.active === false);
      }

      if (input?.excludeCompleted) {
        const done = await completedIds(supabase);
        rows = rows.filter((r) => !done.has(r.id));
      }

      const domains = new Map<string, { total: number; skills: Map<string, number> }>();
      for (const r of rows) {
        if (!r.domain) continue;
        const d = domains.get(r.domain) ?? { total: 0, skills: new Map<string, number>() };
        d.total += 1;
        if (r.skill) d.skills.set(r.skill, (d.skills.get(r.skill) ?? 0) + 1);
        domains.set(r.domain, d);
      }

      return {
        // `total` includes any domain-less verified questions, since
        // "randomize across everything" can still draw them.
        total: rows.length,
        domains: Array.from(domains.entries())
          .map(([domain, v]) => ({
            domain,
            total: v.total,
            skills: Array.from(v.skills.entries())
              .map(([skill, total]) => ({ skill, total }))
              .sort((a, b) => a.skill.localeCompare(b.skill)),
          }))
          .sort((a, b) => a.domain.localeCompare(b.domain)),
      };
    }),

  /**
   * Assemble a randomized, verified-only question set for the browse flow.
   *
   * ═══ Answer-stripping site ═══
   * Returns only SAFE_QUESTION_COLUMNS — never `correct_answer`/`explanation`.
   * Those come one at a time from `reveal`, so a set can't be mined for answers.
   */
  buildCustomSet: protectedProcedure
    .input(
      z.object({
        section: sectionSchema.default('reading_writing'),
        domains: z.array(questionDomainSchema).optional(),
        skills: z.array(z.string()).optional(),
        difficulty: z.array(questionDifficultySchema).optional(),
        count: z.number().int().min(1).max(100),
        excludeCompleted: z.boolean().default(false),
        /** Drop questions still live in Bluebook (active = true). */
        excludeActive: z.boolean().default(false),
        /** Release cohort to draw from: all | original pool | newly-released batch. */
        cohort: cohortSchema.optional(),
        /** 'random' shuffles the draw; 'in_order' keeps question position order. */
        order: z.enum(['random', 'in_order']).default('random'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase } = ctx;
      const cohort = input.cohort ?? 'all';

      // Paged: an unscoped ("randomize everything") or large-domain pool can
      // exceed 1000 rows, and a truncated pool would bias the random draw.
      const makeIdQuery = (from: number, to: number) => {
        let q = supabase
          .from('questions')
          .select('id, position, active')
          .eq('extraction_status', 'verified')
          .eq('section', input.section)
          .order('id', { ascending: true });
        // Skills are the narrower scope; when present they already imply a domain.
        if (input.skills?.length) q = q.in('skill', input.skills);
        else if (input.domains?.length) q = q.in('domain', input.domains);
        if (input.difficulty?.length) q = q.in('difficulty', input.difficulty);
        // Same Original/New split as the counts, so a built set matches the tiles.
        if (cohort === 'original') q = q.is('release_batch', null);
        else if (cohort === 'new') q = q.not('release_batch', 'is', null);
        return q.range(from, to);
      };

      let pool: { id: string; position: number | null; active: boolean | null }[];
      try {
        pool = await fetchAllRows<{ id: string; position: number | null; active: boolean | null }>(makeIdQuery);
      } catch (error) {
        console.error('❌ [questions.buildCustomSet] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not build the set' });
      }

      // Keep only explicitly-disclosed official questions: drop active === true
      // (live in Bluebook) and active === null (questions from other banks).
      if (input.excludeActive) {
        pool = pool.filter((r) => r.active === false);
      }

      if (input.excludeCompleted) {
        const done = await completedIds(supabase);
        pool = pool.filter((r) => !done.has(r.id));
      }

      // 'in_order' walks the first N questions by position (nulls last, id as a
      // stable tie-break); 'random' draws a shuffled subset.
      const chosen =
        input.order === 'in_order'
          ? [...pool]
              .sort((a, b) => {
                const pa = a.position ?? Number.POSITIVE_INFINITY;
                const pb = b.position ?? Number.POSITIVE_INFINITY;
                return pa !== pb ? pa - pb : a.id.localeCompare(b.id);
              })
              .slice(0, input.count)
              .map((r) => r.id)
          : shuffle(pool.map((r) => r.id)).slice(0, input.count);
      if (chosen.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: input.excludeCompleted
            ? 'No new questions match that selection. Widen the scope or turn off "exclude already done".'
            : 'No questions match that selection.',
        });
      }

      const { data: rows, error: rowsError } = await supabase
        .from('questions')
        .select(SAFE_QUESTION_COLUMNS)
        .in('id', chosen);
      if (rowsError) {
        console.error('❌ [questions.buildCustomSet] Load failed:', rowsError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load the set' });
      }

      // Preserve the chosen order (`in` doesn't).
      const byId = new Map((rows ?? []).map((r) => [(r as { id: string }).id, r]));
      const questions = chosen.map((id) => byId.get(id)).filter(Boolean);

      return { questions, requested: input.count, available: pool.length };
    }),

  /**
   * Hand back one question's correct answer + explanation for the untimed
   * taker — read-only, records nothing. The taker prefetches this the moment a
   * choice is selected, so "Check" reveals instantly without waiting on a write.
   *
   * ═══ Reveal site ═══
   * Together with `buildCustomSet` (which ships no answers) this keeps a set from
   * being mined in bulk: the client fetches an answer only per question, and the
   * taker only calls it once the user has committed to a pick. The attempt is
   * still recorded separately by `check`.
   */
  reveal: protectedProcedure
    .input(z.object({ questionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: q, error } = await ctx.supabase
        .from('questions')
        .select('correct_answer, explanation, answer_format, accepted_answers')
        .eq('id', input.questionId)
        .single();
      if (error || !q) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
      }
      // For SPR the "correct answer" shown is the full accepted-answer list.
      const correctAnswer =
        q.answer_format === 'spr' && Array.isArray(q.accepted_answers)
          ? (q.accepted_answers as unknown[]).map(String).join(', ')
          : q.correct_answer;
      return { correctAnswer, explanation: q.explanation, answerFormat: q.answer_format };
    }),

  /**
   * Record one question's attempt in the untimed question-bank taker: grade the
   * user's selected choice server-side and write it to the unified `answers`
   * table (`source: 'bank'`, `attempt_id: null`) with its correctness and
   * per-question time, feeding the same analytics as timed tests. The correct
   * answer/explanation for the UI come from `reveal`; this call is fire-and-forget
   * from the taker's perspective, so recording never blocks the reveal.
   *
   * `selectedAnswer` is optional so a user could record without a pick (stored
   * with `is_correct: null`). `timeSpentMs` is the per-question count-up timer.
   */
  check: protectedProcedure
    .input(
      z.object({
        questionId: z.string().uuid(),
        selectedAnswer: answerValueSchema.optional(),
        timeSpentMs: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: q, error } = await supabase
        .from('questions')
        .select('id, correct_answer, explanation, answer_format, accepted_answers')
        .eq('id', input.questionId)
        .single();

      if (error || !q) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
      }

      const isCorrect =
        input.selectedAnswer !== undefined
          ? isResponseCorrect(q as never, input.selectedAnswer)
          : null;

      const correctAnswerDisplay =
        q.answer_format === 'spr' && Array.isArray(q.accepted_answers)
          ? (q.accepted_answers as unknown[]).map(String).join(', ')
          : q.correct_answer;

      const { error: insertError } = await supabase.from('answers').insert({
        question_id: q.id,
        user_id: user.id,
        source: 'bank',
        attempt_id: null,
        selected_answer: input.selectedAnswer ?? null,
        is_correct: isCorrect,
        time_spent_ms: input.timeSpentMs ?? null,
        answered_at: new Date().toISOString(),
      });
      if (insertError) {
        console.error('❌ [questions.check] Failed to record attempt:', insertError);
      }

      return { correctAnswer: correctAnswerDisplay, explanation: q.explanation, isCorrect };
    }),
});
