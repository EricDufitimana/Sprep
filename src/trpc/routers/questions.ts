import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import {
  answerLetterSchema,
  extractionStatusSchema,
  questionDifficultySchema,
  questionDomainSchema,
  questionOptionsSchema,
} from '@/lib/validation';

/**
 * Reading and repairing individual questions.
 *
 * This is the only path by which a `needs_review` question becomes `verified`
 * and therefore eligible to appear in a test. Procedures here legitimately
 * return `correct_answer` — the caller owns the bank and is reviewing it
 * outside any sitting. Nothing in the test lifecycle reads from this router.
 */

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
});
