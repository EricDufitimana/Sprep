import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { answerLetterSchema } from '@/lib/validation';

/**
 * Per-question writes during a sitting.
 *
 * ═══ SECURITY INVARIANT (site 3) ═══
 * Nothing here reads `questions.correct_answer` or writes `answers.is_correct`.
 * Grading belongs to `tests.submit` alone. If a future change makes this file
 * touch either field, the no-answer-leakage guarantee is gone.
 */

/** Shared guard: the attempt is the caller's and still open for writes. */
async function assertWritableAttempt(
  supabase: NonNullable<Awaited<ReturnType<typeof import('../init').createTRPCContext>>['supabase']>,
  attemptId: string,
  userId: string,
) {
  const { data: attempt, error } = await supabase
    .from('test_attempts')
    .select('id, user_id, status')
    .eq('id', attemptId)
    .single();

  if (error || !attempt) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
  }
  if (attempt.user_id !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
  }
  if (attempt.status !== 'in_progress') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This test has already been submitted',
    });
  }
  return attempt;
}

export const answersRouter = createTRPCRouter({
  /**
   * Autosave. Called repeatedly as the user picks and re-picks, so it upserts
   * on the `(attempt_id, question_id)` unique constraint rather than inserting.
   * Passing `selectedAnswer: null` clears a pick.
   */
  save: protectedProcedure
    .input(
      z.object({
        attemptId: z.string().uuid(),
        questionId: z.string().uuid(),
        selectedAnswer: answerLetterSchema.nullable().optional(),
        flagged: z.boolean().optional(),
        /** Cumulative ms the user has spent on this question so far. */
        timeSpentMs: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;
      await assertWritableAttempt(supabase, input.attemptId, user.id);

      // Only the fields the client is allowed to set. `is_correct` is absent
      // by design — it is written once, by `tests.submit`.
      const row: Record<string, unknown> = {
        attempt_id: input.attemptId,
        question_id: input.questionId,
        user_id: user.id,
        answered_at: new Date().toISOString(),
      };
      if (input.selectedAnswer !== undefined) row.selected_answer = input.selectedAnswer;
      if (input.flagged !== undefined) row.flagged = input.flagged;
      if (input.timeSpentMs !== undefined) row.time_spent_ms = input.timeSpentMs;

      const { error } = await supabase
        .from('answers')
        .upsert(row, { onConflict: 'attempt_id,question_id' });

      if (error) {
        console.error('❌ [answers.save] Upsert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save your answer' });
      }

      return { success: true };
    }),

  /**
   * Writes the "why I missed it" note that gates the explanation reveal on the
   * results screen. Allowed after submission — that is when the user writes it.
   */
  saveDiagnosis: protectedProcedure
    .input(
      z.object({
        attemptId: z.string().uuid(),
        questionId: z.string().uuid(),
        text: z
          .string()
          .min(10, { message: 'Write at least a sentence about what went wrong' })
          .max(2000, { message: 'Keep the diagnosis under 2000 characters' }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error: attemptError } = await supabase
        .from('test_attempts')
        .select('id, user_id')
        .eq('id', input.attemptId)
        .single();

      if (attemptError || !attempt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      }
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }

      const { error } = await supabase
        .from('answers')
        .update({ self_diagnosis: input.text })
        .eq('attempt_id', input.attemptId)
        .eq('question_id', input.questionId);

      if (error) {
        console.error('❌ [answers.saveDiagnosis] Update failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save your note' });
      }

      return { success: true };
    }),

  /**
   * Rehydrates an in-progress attempt (refresh, or resuming on another device).
   * Returns picks and flags only — never correctness.
   */
  listForAttempt: protectedProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: attempt, error: attemptError } = await supabase
        .from('test_attempts')
        .select('id, user_id')
        .eq('id', input.attemptId)
        .single();

      if (attemptError || !attempt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
      }
      if (attempt.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That attempt is not yours' });
      }

      const { data, error } = await supabase
        .from('answers')
        .select('question_id, selected_answer, flagged')
        .eq('attempt_id', input.attemptId);

      if (error) {
        console.error('❌ [answers.listForAttempt] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your answers' });
      }

      return data ?? [];
    }),
});
