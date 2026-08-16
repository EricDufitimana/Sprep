import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTRPCRouter, protectedProcedure } from '../init';
import { scoreAttempt, type ScorableAnswer, type ScorableQuestion } from '@/utils/scoring';
import { fetchAllRows } from '@/utils/paginate';
import { selectExamModule, type PoolItem } from '@/utils/sat-module';
import { planFor, selectQuestionIds } from './modules-management';
import { COMPLETED_ANSWER_FILTER } from './questions';
import { questionDifficultySchema, sectionSchema } from '@/lib/validation';

/**
 * Test lifecycle: start → (answers.save autosaves) → submit → getResults.
 *
 * ═══ SECURITY INVARIANT ═══
 * While an attempt is `in_progress`, no procedure in this file may return
 * `correct_answer` or `explanation`. Both are omitted from the SELECT column
 * list in `start` (site 1), and `getResults` refuses to run until the attempt
 * is `submitted` (site 2). Grading happens only inside `submit`.
 *
 * Every query uses `ctx.supabase`, the RLS-scoped per-request client, so the
 * database enforces ownership even where an explicit check is also written.
 */

/** Columns safe to send to a client mid-test. Note the two absentees. */
const SAFE_QUESTION_COLUMNS =
  'id, external_id, position, passage, question_text, options, has_visual, visual_data, visual_url, domain, skill, difficulty, section, answer_format';

/** Shape of a row selected with SAFE_QUESTION_COLUMNS. */
interface SafeQuestion {
  id: string;
  external_id: string | null;
  position: number | null;
  passage: string | null;
  question_text: string;
  options: unknown;
  has_visual: boolean;
  visual_data: string | null;
  visual_url: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: string | null;
  section: string;
  answer_format: string;
}

/**
 * The ordered question ids frozen for an attempt at start time.
 *
 * Every attempt — bank or module — records its exact question set here, so a
 * sitting is reproducible across refreshes and can span banks. Returns [] for
 * legacy attempts created before this table existed; callers fall back to the
 * bank-derived path in that case.
 */
async function frozenQuestionIds(supabase: SupabaseClient, attemptId: string): Promise<string[]> {
  const { data } = await supabase
    .from('attempt_questions')
    .select('question_id, position')
    .eq('attempt_id', attemptId)
    .order('position', { ascending: true });
  return (data ?? []).map((r) => r.question_id as string);
}

/** Reorder fetched rows to match a given id order (Postgres `in` won't preserve it). */
function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
}

interface Selection {
  orderedIds: string[];
  sourceName: string;
  bankId: string | null;
  moduleId: string | null;
  /** Set only for ad-hoc sittings, which have no bank/module row to name them. */
  title?: string | null;
}

/**
 * Every question the caller has already completed, in any mode. The unified
 * `answers` table is the single source of truth for "already done" — it spans
 * timed tests, modules, and the untimed question bank alike. RLS scopes the
 * read to the current user, so no explicit user filter is needed.
 */
async function completedQuestionIds(supabase: SupabaseClient): Promise<Set<string>> {
  // Paged so a user with more than PostgREST's 1000-row cap of answer rows
  // still gets a complete "already done" set to exclude against.
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

/** Pick questions for a single-bank sitting (the original flow, now id-only). */
async function selectForBank(
  supabase: SupabaseClient,
  userId: string,
  bankId: string,
  excludeSeen: boolean,
  questionCount: number | undefined,
): Promise<Selection> {
  const { data: bank, error: bankError } = await supabase
    .from('question_banks')
    .select('id, name, user_id, is_default')
    .eq('id', bankId)
    .single();

  if (bankError || !bank) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Question bank not found' });
  }
  if (!bank.is_default && bank.user_id !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'That question bank is not yours' });
  }

  let query = supabase
    .from('questions')
    .select('id')
    .eq('bank_id', bankId)
    .eq('extraction_status', 'verified')
    .order('position', { ascending: true, nullsFirst: false });

  if (excludeSeen) {
    const seen = await completedQuestionIds(supabase);
    if (seen.size > 0) query = query.not('id', 'in', `(${Array.from(seen).join(',')})`);
  }

  if (questionCount) query = query.limit(questionCount);

  const { data, error } = await query;
  if (error) {
    console.error('❌ [tests.start] bank selection failed:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load questions' });
  }

  return {
    orderedIds: (data ?? []).map((r) => r.id as string),
    sourceName: bank.name,
    bankId,
    moduleId: null,
  };
}

/**
 * Pick questions for a module sitting: re-run the recipe against the *current*
 * pool (so previously-seen questions are excluded, giving fresh content each
 * time) and select a balanced, shuffled set.
 */
async function selectForModule(
  supabase: SupabaseClient,
  userId: string,
  moduleId: string,
): Promise<Selection> {
  const { data: mod, error } = await supabase
    .from('modules')
    .select('id, name, format, total_questions, source_bank_ids, plan')
    .eq('id', moduleId)
    .single();

  if (error || !mod) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Module not found' });
  }

  const bankIds = mod.source_bank_ids as string[];

  // Fresh pool: verified questions in the source banks, minus everything the
  // user has already completed in any mode (unified answers table). Paged so
  // a large default bank (>1000 rows) isn't silently truncated.
  const all = await fetchAllRows<{ id: string; domain: string | null }>((from, to) =>
    supabase
      .from('questions')
      .select('id, domain')
      .in('bank_id', bankIds)
      .eq('extraction_status', 'verified')
      .order('id', { ascending: true })
      .range(from, to),
  );

  const seen = await completedQuestionIds(supabase);
  const pool = (all ?? []).filter((q) => !seen.has(q.id)) as { id: string; domain: string | null }[];

  const available: Record<string, number> = {};
  for (const q of pool) {
    const d = q.domain ?? 'unclassified';
    available[d] = (available[d] ?? 0) + 1;
  }

  // Custom modules keep their exact per-domain plan; DSAT re-balances to length.
  const customCounts = mod.format === 'custom' ? (mod.plan as Record<string, number>) : undefined;
  const plan = planFor(mod.format as 'dsat' | 'custom', mod.total_questions, customCounts, available);
  const orderedIds = selectQuestionIds(pool, plan);

  return { orderedIds, sourceName: mod.name, bankId: null, moduleId };
}

/** The criteria a "build an exam module" sitting draws from (no bank/module). */
interface AdhocCriteria {
  section: 'reading_writing' | 'math';
  difficulty?: ('easy' | 'medium' | 'hard')[];
  count: number;
  cohort: 'all' | 'original' | 'new';
  excludeActive: boolean;
  excludeCompleted: boolean;
}

/** A human-readable name for an ad-hoc module, e.g. "Hard · Math exam module". */
function adhocTitle(section: AdhocCriteria['section'], difficulty: string[] | undefined): string {
  const sectionLabel = section === 'math' ? 'Math' : 'Reading & Writing';
  const diffLabel =
    difficulty && difficulty.length === 1
      ? difficulty[0][0].toUpperCase() + difficulty[0].slice(1)
      : 'Mixed';
  return `${diffLabel} · ${sectionLabel} exam module`;
}

/**
 * Pick questions for an ad-hoc "exam module" sitting: draw from the whole
 * verified pool for a section (every bank the user can see, via RLS), filtered
 * by difficulty / release cohort / disclosure, then balance and order it like a
 * real Bluebook module (`selectExamModule`). This is the Question Bank's "build
 * a module" flow — it saves no bank or module, just sits a fresh set.
 */
async function selectForAdhoc(supabase: SupabaseClient, adhoc: AdhocCriteria): Promise<Selection> {
  // Paged: a section's verified pool exceeds PostgREST's 1000-row cap, and a
  // truncated pool would bias both the balance and the random draw.
  const pool = await fetchAllRows<PoolItem & { active: boolean | null }>((from, to) => {
    let q = supabase
      .from('questions')
      .select('id, domain, skill, difficulty, position, answer_format, active')
      .eq('extraction_status', 'verified')
      .eq('section', adhoc.section)
      .order('id', { ascending: true });
    if (adhoc.difficulty?.length) q = q.in('difficulty', adhoc.difficulty);
    if (adhoc.cohort === 'original') q = q.is('release_batch', null);
    else if (adhoc.cohort === 'new') q = q.not('release_batch', 'is', null);
    return q.range(from, to);
  });

  // Keep only explicitly-disclosed official questions when asked (active === false;
  // drop active === true live-in-Bluebook and active === null non-CB questions).
  let items: PoolItem[] = adhoc.excludeActive ? pool.filter((r) => r.active === false) : pool;

  if (adhoc.excludeCompleted) {
    const seen = await completedQuestionIds(supabase);
    items = items.filter((r) => !seen.has(r.id));
  }

  const mod = selectExamModule(items, adhoc.section, adhoc.count);
  const title = adhocTitle(adhoc.section, adhoc.difficulty);
  return { orderedIds: mod.orderedIds, sourceName: title, bankId: null, moduleId: null, title };
}

export const testsRouter = createTRPCRouter({
  start: protectedProcedure
    .input(
      z
        .object({
          /** Exactly one source. A bank sits one bank; a module spans several;
           *  an ad-hoc "exam module" draws fresh from the whole verified pool. */
          bankId: z.string().uuid().optional(),
          moduleId: z.string().uuid().optional(),
          adhoc: z
            .object({
              section: sectionSchema,
              /** Omit / empty = any difficulty. The builder defaults this to hard. */
              difficulty: z.array(questionDifficultySchema).optional(),
              count: z.number().int().min(1).max(120),
              cohort: z.enum(['all', 'original', 'new']).default('all'),
              excludeActive: z.boolean().default(false),
              excludeCompleted: z.boolean().default(false),
            })
            .optional(),
          /** False runs the sitting without a countdown; elapsed time is still recorded. */
          timed: z.boolean().default(true),
          timerSeconds: z.number().int().min(60).max(10800).optional(),
          /** Bank sittings only. */
          questionCount: z.number().int().min(1).max(200).optional(),
          excludeSeen: z.boolean().default(false),
        })
        .refine((v) => (v.bankId ? 1 : 0) + (v.moduleId ? 1 : 0) + (v.adhoc ? 1 : 0) === 1, {
          message: 'Start exactly one of a bank, a module, or an ad-hoc module',
        })
        .refine((v) => !v.timed || typeof v.timerSeconds === 'number', {
          message: 'A timed sitting needs a duration',
          path: ['timerSeconds'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      // Build the ordered id list + a display name, from whichever source.
      const { orderedIds, sourceName, bankId, moduleId, title } = input.adhoc
        ? await selectForAdhoc(supabase, input.adhoc)
        : input.moduleId
          ? await selectForModule(supabase, user.id, input.moduleId)
          : await selectForBank(supabase, user.id, input.bankId!, input.excludeSeen, input.questionCount);

      if (orderedIds.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: input.adhoc
            ? 'No questions match this module. Loosen the difficulty, switch cohort, or turn off exclusions.'
            : input.excludeSeen
              ? 'You have already answered every question here. Turn off "skip questions I have done" to sit it again.'
              : 'Nothing verified to sit here yet.',
        });
      }

      // Open the attempt.
      const { data: attempt, error: attemptError } = await supabase
        .from('test_attempts')
        .insert({
          bank_id: bankId,
          module_id: moduleId,
          title: title ?? null,
          timer_seconds: input.timed ? input.timerSeconds : null,
          was_timed: input.timed,
          total_questions: orderedIds.length,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .select('id, timer_seconds, was_timed, started_at')
        .single();

      if (attemptError || !attempt) {
        console.error('❌ [tests.start] Failed to create attempt:', attemptError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not start the test' });
      }

      // Freeze the selection so the sitting is reproducible and can span banks.
      const { error: freezeError } = await supabase
        .from('attempt_questions')
        .insert(orderedIds.map((question_id, position) => ({ attempt_id: attempt.id, question_id, position })));

      if (freezeError) {
        console.error('❌ [tests.start] Failed to freeze questions:', freezeError);
        await supabase.from('test_attempts').delete().eq('id', attempt.id);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not start the test' });
      }

      const { data: rows } = await supabase
        .from('questions')
        .select(SAFE_QUESTION_COLUMNS)
        .in('id', orderedIds);

      return {
        attemptId: attempt.id,
        timed: attempt.was_timed,
        timerSeconds: attempt.timer_seconds,
        startedAt: attempt.started_at,
        bankName: sourceName,
        questions: orderByIds((rows ?? []) as unknown as SafeQuestion[], orderedIds),
      };
    }),

  /**
   * Rehydrate an in-progress sitting (page refresh, or resuming later).
   *
   * ═══ Answer-stripping site 4 ═══
   * Reuses SAFE_QUESTION_COLUMNS, so `correct_answer`/`explanation` are never
   * selected. Refuses outright once the attempt is submitted — the results
   * route is the only way to see a graded sitting.
   */
  getAttempt: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error } = await supabase
        .from('test_attempts')
        .select('id, user_id, bank_id, module_id, title, status, timer_seconds, was_timed, total_questions, started_at, resumed_at, time_used_seconds, question_banks ( name ), modules ( name )')
        .eq('id', input.attemptId)
        .single();

      if (error || !attempt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      }
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }
      // A paused sitting is resumable, so it loads too; only a submitted one is done.
      if (attempt.status !== 'in_progress' && attempt.status !== 'paused') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This test has already been submitted',
        });
      }

      // Read the frozen set. Legacy attempts (pre-freeze) fall back to bank order.
      const frozen = await frozenQuestionIds(supabase, attempt.id);
      let questions: SafeQuestion[] = [];

      if (frozen.length > 0) {
        const { data, error: qError } = await supabase
          .from('questions')
          .select(SAFE_QUESTION_COLUMNS)
          .in('id', frozen);
        if (qError) {
          console.error('❌ [tests.getAttempt] Failed to load questions:', qError);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load questions' });
        }
        questions = orderByIds((data ?? []) as unknown as SafeQuestion[], frozen);
      } else if (attempt.bank_id) {
        const { data } = await supabase
          .from('questions')
          .select(SAFE_QUESTION_COLUMNS)
          .eq('bank_id', attempt.bank_id)
          .eq('extraction_status', 'verified')
          .order('position', { ascending: true, nullsFirst: false })
          .limit(attempt.total_questions ?? 200);
        questions = (data ?? []) as unknown as SafeQuestion[];
      }

      const bankName = (attempt.question_banks as unknown as { name: string } | null)?.name;
      const moduleName = (attempt.modules as unknown as { name: string } | null)?.name;

      return {
        attemptId: attempt.id,
        bankId: attempt.bank_id,
        bankName: moduleName ?? bankName ?? attempt.title ?? 'Question set',
        timed: attempt.was_timed,
        timerSeconds: attempt.timer_seconds,
        startedAt: attempt.started_at,
        // Pause/resume timing. `resumedAt` anchors the current running segment
        // (falls back to started_at for legacy attempts); `timeUsedSeconds` is
        // the active time already spent in earlier segments. Remaining time is
        // (timerSeconds − timeUsedSeconds) counted down from resumedAt.
        status: attempt.status as 'in_progress' | 'paused',
        resumedAt: attempt.resumed_at ?? attempt.started_at,
        timeUsedSeconds: attempt.time_used_seconds ?? 0,
        questions,
      };
    }),

  /**
   * Pause an in-progress sitting: fold the active time since `resumed_at` into
   * `time_used_seconds` and mark it 'paused', which freezes the countdown. The
   * answers themselves are already autosaved by `answers.save`, so this only
   * needs to stop the clock. Idempotent — pausing an already-paused sitting is a
   * no-op. Timed sittings cap the accumulator at the timer so a long-open tab
   * can't bank negative time.
   */
  pause: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error } = await supabase
        .from('test_attempts')
        .select('id, user_id, status, started_at, resumed_at, time_used_seconds, timer_seconds, was_timed')
        .eq('id', input.attemptId)
        .single();

      if (error || !attempt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }
      if (attempt.status === 'submitted') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This test is already submitted' });
      }
      if (attempt.status === 'paused') return { success: true, alreadyPaused: true };

      const anchor = new Date(attempt.resumed_at ?? attempt.started_at).getTime();
      const segment = Math.max(0, Math.round((Date.now() - anchor) / 1000));
      let used = (attempt.time_used_seconds ?? 0) + segment;
      if (attempt.was_timed && attempt.timer_seconds) used = Math.min(used, attempt.timer_seconds);

      const { error: updateError } = await supabase
        .from('test_attempts')
        .update({ status: 'paused', time_used_seconds: used })
        .eq('id', input.attemptId);

      if (updateError) {
        console.error('❌ [tests.pause] Failed to pause:', updateError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not pause the test' });
      }
      return { success: true, alreadyPaused: false };
    }),

  /**
   * Resume a paused sitting: stamp `resumed_at` to now and flip back to
   * 'in_progress', so the countdown restarts from the remaining time
   * (timer_seconds − time_used_seconds). No-op if it's already running.
   */
  resume: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error } = await supabase
        .from('test_attempts')
        .select('id, user_id, status, timer_seconds, time_used_seconds, was_timed')
        .eq('id', input.attemptId)
        .single();

      if (error || !attempt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }
      if (attempt.status === 'submitted') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This test is already submitted' });
      }

      const resumedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('test_attempts')
        .update({ status: 'in_progress', resumed_at: resumedAt })
        .eq('id', input.attemptId);

      if (updateError) {
        console.error('❌ [tests.resume] Failed to resume:', updateError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not resume the test' });
      }
      return {
        success: true,
        resumedAt,
        timeUsedSeconds: attempt.time_used_seconds ?? 0,
        timerSeconds: attempt.timer_seconds,
        timed: attempt.was_timed,
      };
    }),

  submit: protectedProcedure
    .input(
      z.object({
        attemptId: z.string().uuid(),
        timeUsedSeconds: z.number().int().min(0).max(10800),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error: attemptError } = await supabase
        .from('test_attempts')
        .select('id, user_id, bank_id, module_id, status, total_questions, correct_count, score_percent, time_used_seconds, submitted_at, started_at, resumed_at, timer_seconds, was_timed')
        .eq('id', input.attemptId)
        .single();

      if (attemptError || !attempt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      }
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }

      // Idempotency: a resubmit returns the stored snapshot untouched.
      // Scores are written once and never recomputed.
      if (attempt.status === 'submitted') {
        return buildResults(await loadReviewRows(ctx, input.attemptId), {
          alreadySubmitted: true,
          timeUsedSeconds: attempt.time_used_seconds ?? 0,
        });
      }

      // Grade against the frozen set, so a module spanning banks scores its own
      // exact questions. Legacy attempts fall back to the bank order.
      const frozen = await frozenQuestionIds(supabase, attempt.id);
      const gradeQuery = supabase
        .from('questions')
        .select('id, domain, skill, correct_answer, answer_format, accepted_answers');
      const { data: questions, error: qError } =
        frozen.length > 0
          ? await gradeQuery.in('id', frozen)
          : await gradeQuery
              .eq('bank_id', attempt.bank_id)
              .eq('extraction_status', 'verified')
              .order('position', { ascending: true, nullsFirst: false })
              .limit(attempt.total_questions ?? 200);

      const { data: answers, error: aError } = await supabase
        .from('answers')
        .select('question_id, selected_answer, flagged')
        .eq('attempt_id', input.attemptId);

      if (qError || aError || !questions) {
        console.error('❌ [tests.submit] Load failed:', qError ?? aError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not grade the test' });
      }

      const scored = scoreAttempt(
        questions as ScorableQuestion[],
        (answers ?? []) as ScorableAnswer[],
      );

      // Time used is computed server-side from the pause/resume accounting rather
      // than trusted from the client: the frozen accumulator plus, if the sitting
      // is still running (not paused), the active segment since `resumed_at`.
      // Capped at the timer for timed sittings.
      const activeSegment =
        attempt.status === 'in_progress'
          ? Math.max(0, Math.round((Date.now() - new Date(attempt.resumed_at ?? attempt.started_at).getTime()) / 1000))
          : 0;
      let timeUsedSeconds = (attempt.time_used_seconds ?? 0) + activeSegment;
      if (attempt.was_timed && attempt.timer_seconds) {
        timeUsedSeconds = Math.min(timeUsedSeconds, attempt.timer_seconds);
      }

      // Persist the snapshot: attempt totals first, then per-answer correctness.
      const { error: updateError } = await supabase
        .from('test_attempts')
        .update({
          correct_count: scored.correctCount,
          score_percent: scored.scorePercent,
          total_questions: scored.totalQuestions,
          time_used_seconds: timeUsedSeconds,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', input.attemptId);

      if (updateError) {
        console.error('❌ [tests.submit] Failed to persist score:', updateError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save your score' });
      }

      // Upsert grades into the unified answers table. Unanswered questions get
      // a row so the review list is complete and `is_correct` is explicit rather
      // than absent. `source` records how the sitting was run, so bank practice
      // (source 'bank') and sittings share one table without ambiguity. This is
      // now the only completion record — there is no separate history table.
      const source = attempt.module_id ? 'module' : 'test';
      const gradeRows = scored.graded.map((g) => ({
        attempt_id: input.attemptId,
        question_id: g.question_id,
        user_id: user.id,
        source,
        selected_answer: g.selected_answer,
        is_correct: g.is_correct,
        flagged: g.flagged,
      }));

      const { error: gradeError } = await supabase
        .from('answers')
        .upsert(gradeRows, { onConflict: 'attempt_id,question_id' });

      if (gradeError) {
        console.error('❌ [tests.submit] Failed to persist grades:', gradeError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save your answers' });
      }

      return buildResults(await loadReviewRows(ctx, input.attemptId), {
        alreadySubmitted: false,
        timeUsedSeconds,
      });
    }),

  getResults: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error } = await supabase
        .from('test_attempts')
        .select('id, user_id, status, time_used_seconds')
        .eq('id', input.attemptId)
        .single();

      if (error || !attempt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      }
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }

      // ═══ Answer-stripping site 2 ═══
      // Results carry `correct_answer` and `explanation`. Refusing here is what
      // stops a client from reading answers out of an in-progress test.
      if (attempt.status !== 'submitted') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Results are available only after the test is submitted',
        });
      }

      return buildResults(await loadReviewRows(ctx, input.attemptId), {
        alreadySubmitted: true,
        timeUsedSeconds: attempt.time_used_seconds ?? 0,
      });
    }),

  listAttempts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;

      const { data, error } = await ctx.supabase
        .from('test_attempts')
        .select(`
          id,
          bank_id,
          title,
          status,
          score_percent,
          correct_count,
          total_questions,
          time_used_seconds,
          timer_seconds,
          was_timed,
          started_at,
          submitted_at,
          question_banks ( name ),
          modules ( name )
        `)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('❌ [tests.listAttempts] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your attempts' });
      }

      // Section summary needs per-domain correctness, which lives on `answers`.
      // Only submitted attempts have `is_correct` written, so an unfinished one
      // would render as 0/n across every domain — worse than showing nothing.
      const attemptIds = (data ?? [])
        .filter((a) => a.status === 'submitted')
        .map((a) => a.id);
      const sectionsByAttempt = new Map<
        string,
        { domain: string; correct: number; total: number; timeMs: number }[]
      >();
      const flaggedByAttempt = new Map<string, number>();

      if (attemptIds.length > 0) {
        const { data: rows } = await ctx.supabase
          .from('answers')
          .select('attempt_id, is_correct, flagged, time_spent_ms, questions ( domain )')
          .in('attempt_id', attemptIds);

        for (const row of rows ?? []) {
          if (row.flagged) {
            flaggedByAttempt.set(row.attempt_id, (flaggedByAttempt.get(row.attempt_id) ?? 0) + 1);
          }
          // PostgREST embeds are typed as arrays by the untyped client even
          // when the FK makes them to-one; narrow through unknown.
          const domain = (row.questions as unknown as { domain: string | null } | null)?.domain;
          if (!domain) continue;
          const timeMs = row.time_spent_ms ?? 0;
          const list = sectionsByAttempt.get(row.attempt_id) ?? [];
          const bucket = list.find((s) => s.domain === domain);
          if (bucket) {
            bucket.total += 1;
            bucket.timeMs += timeMs;
            if (row.is_correct) bucket.correct += 1;
          } else {
            list.push({ domain, correct: row.is_correct ? 1 : 0, total: 1, timeMs });
          }
          sectionsByAttempt.set(row.attempt_id, list);
        }
      }

      return (data ?? []).map((a) => ({
        id: a.id,
        bankId: a.bank_id,
        bankName:
          (a.modules as unknown as { name: string } | null)?.name ??
          (a.question_banks as unknown as { name: string } | null)?.name ??
          a.title ??
          'Untitled test',
        isModule: (a.modules as unknown as { name: string } | null) !== null,
        status: a.status,
        scorePercent: a.score_percent === null ? null : Number(a.score_percent),
        correctCount: a.correct_count,
        totalQuestions: a.total_questions,
        timeUsedSeconds: a.time_used_seconds,
        timerSeconds: a.timer_seconds,
        timed: a.was_timed,
        startedAt: a.started_at,
        submittedAt: a.submitted_at,
        flaggedCount: flaggedByAttempt.get(a.id) ?? 0,
        sections: (sectionsByAttempt.get(a.id) ?? []).sort((x, y) => x.domain.localeCompare(y.domain)),
      }));
    }),

  /**
   * Delete a sitting outright — used to abandon a paused/in-progress attempt the
   * user no longer wants to continue. Cascades to its frozen questions and
   * answers (both FK'd with on delete cascade). RLS also scopes the delete.
   */
  deleteAttempt: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;
      const { data: attempt, error } = await supabase
        .from('test_attempts')
        .select('id, user_id')
        .eq('id', input.attemptId)
        .single();
      if (error || !attempt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }
      const { error: delError } = await supabase
        .from('test_attempts')
        .delete()
        .eq('id', input.attemptId);
      if (delError) {
        console.error('❌ [tests.deleteAttempt] delete failed:', delError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the sitting' });
      }
      return { success: true };
    }),

  /**
   * The questions a user got wrong in a submitted sitting, as SAFE columns (no
   * answers/explanations) — the seed for an untimed "redo your misses" run, which
   * reveals answers one at a time via `questions.reveal`, exactly like the
   * question-bank taker. Only the owner of a submitted attempt can read them.
   */
  failedQuestions: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error: aError } = await supabase
        .from('test_attempts')
        .select('id, user_id, status')
        .eq('id', input.attemptId)
        .single();
      if (aError || !attempt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }

      const { data: rows, error } = await supabase
        .from('answers')
        .select(
          `question_id, is_correct, questions!inner ( ${SAFE_QUESTION_COLUMNS} )`,
        )
        .eq('attempt_id', input.attemptId)
        .eq('is_correct', false);

      if (error) {
        console.error('❌ [tests.failedQuestions] query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your misses' });
      }

      const questions = (rows ?? [])
        .map((r) => r.questions as unknown as SafeQuestion)
        .filter((q): q is SafeQuestion => q != null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      return { questions };
    }),
});

// ── helpers ──────────────────────────────────────────────────────────────────

type ReviewRow = {
  question_id: string;
  selected_answer: string | null;
  is_correct: boolean | null;
  flagged: boolean;
  self_diagnosis: string | null;
  questions: {
    id: string;
    external_id: string | null;
    position: number | null;
    domain: string | null;
    skill: string | null;
    passage: string | null;
    question_text: string;
    options: unknown;
    correct_answer: string;
    explanation: string | null;
    has_visual: boolean;
    visual_data: string | null;
    visual_url: string | null;
    section: string;
    answer_format: string;
    accepted_answers: unknown;
  } | null;
};

/**
 * Load the full review payload for a submitted attempt.
 * Only ever called after a `status === 'submitted'` check or immediately
 * after `submit` writes that status.
 */
async function loadReviewRows(
  ctx: { supabase: NonNullable<Awaited<ReturnType<typeof import('../init').createTRPCContext>>['supabase']> },
  attemptId: string,
): Promise<ReviewRow[]> {
  const { data, error } = await ctx.supabase
    .from('answers')
    .select(`
      question_id,
      selected_answer,
      is_correct,
      flagged,
      self_diagnosis,
      questions (
        id, external_id, position, domain, skill, passage, question_text,
        options, correct_answer, explanation, has_visual, visual_data, visual_url,
        section, answer_format, accepted_answers
      )
    `)
    .eq('attempt_id', attemptId);

  if (error) {
    console.error('❌ [tests] Failed to load review rows:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load results' });
  }

  return ((data ?? []) as unknown as ReviewRow[]).sort(
    (a, b) => (a.questions?.position ?? 0) - (b.questions?.position ?? 0),
  );
}

function tally(rows: ReviewRow[], pick: (r: ReviewRow) => string | null) {
  const buckets = new Map<string, { correct: number; total: number }>();
  for (const r of rows) {
    const key = pick(r);
    if (!key) continue;
    const b = buckets.get(key) ?? { correct: 0, total: 0 };
    b.total += 1;
    if (r.is_correct) b.correct += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .map(([key, b]) => ({
      key,
      correct: b.correct,
      total: b.total,
      accuracyPercent: b.total === 0 ? 0 : Math.round((b.correct / b.total) * 1000) / 10,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Shape the review rows into the results payload the client renders. */
function buildResults(
  rows: ReviewRow[],
  meta: { alreadySubmitted: boolean; timeUsedSeconds: number },
) {
  const total = rows.length;
  const correct = rows.filter((r) => r.is_correct).length;

  return {
    alreadySubmitted: meta.alreadySubmitted,
    timeUsedSeconds: meta.timeUsedSeconds,
    totalQuestions: total,
    correctCount: correct,
    scorePercent: total === 0 ? 0 : Math.round((correct / total) * 1000) / 10,
    answeredCount: rows.filter((r) => r.selected_answer !== null).length,
    unansweredCount: rows.filter((r) => r.selected_answer === null).length,
    flaggedCount: rows.filter((r) => r.flagged).length,
    byDomain: tally(rows, (r) => r.questions?.domain ?? null),
    bySkill: tally(rows, (r) => r.questions?.skill ?? null),
    questions: rows.map((r) => ({
      questionId: r.question_id,
      externalId: r.questions?.external_id ?? null,
      position: r.questions?.position ?? null,
      domain: r.questions?.domain ?? null,
      skill: r.questions?.skill ?? null,
      passage: r.questions?.passage ?? null,
      questionText: r.questions?.question_text ?? '',
      options: r.questions?.options ?? [],
      hasVisual: r.questions?.has_visual ?? false,
      visualData: r.questions?.visual_data ?? null,
      visualUrl: r.questions?.visual_url ?? null,
      selectedAnswer: r.selected_answer,
      correctAnswer: r.questions?.correct_answer ?? null,
      explanation: r.questions?.explanation ?? null,
      section: r.questions?.section ?? 'reading_writing',
      answerFormat: r.questions?.answer_format ?? 'mcq',
      acceptedAnswers: r.questions?.accepted_answers ?? null,
      isCorrect: r.is_correct ?? false,
      flagged: r.flagged,
      selfDiagnosis: r.self_diagnosis,
    })),
  };
}
