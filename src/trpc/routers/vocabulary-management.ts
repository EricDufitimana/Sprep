import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { vocabularyWordSchema, wordChargeSchema } from '@/lib/validation';

/**
 * Vocabulary sets, words, and drill attempts.
 *
 * The trainer teaches decoding from context, so `sentence` is required by
 * `vocabularyWordSchema` even though the column is nullable — a word without
 * a sentence can't be drilled the way this app drills.
 */

export const vocabularyManagementRouter = createTRPCRouter({
  listSets: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('vocabulary_sets')
      .select('id, name, created_at, vocabulary_words ( count )')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ [vocabulary.listSets] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your sets' });
    }

    return (data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.created_at,
      wordCount: (s.vocabulary_words as unknown as { count: number }[])?.[0]?.count ?? 0,
    }));
  }),

  createSet: protectedProcedure
    .input(z.object({ name: z.string().min(1, { message: 'Name is required' }).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('vocabulary_sets')
        .insert({ name: input.name })
        .select('id, name, created_at')
        .single();

      if (error || !data) {
        console.error('❌ [vocabulary.createSet] Insert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create the set' });
      }

      return { success: true, set: data };
    }),

  deleteSet: protectedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('vocabulary_sets').delete().eq('id', input.setId);

      if (error) {
        console.error('❌ [vocabulary.deleteSet] Delete failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the set' });
      }

      return { success: true };
    }),

  listWords: protectedProcedure
    .input(z.object({ setId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from('vocabulary_words')
        .select('id, set_id, word, sentence, definition, root, charge, part_of_speech, created_at')
        .order('created_at', { ascending: true });

      if (input?.setId) query = query.eq('set_id', input.setId);

      const { data, error } = await query;

      if (error) {
        console.error('❌ [vocabulary.listWords] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load words' });
      }

      return data ?? [];
    }),

  createWord: protectedProcedure
    .input(vocabularyWordSchema.extend({ setId: z.string().uuid().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { setId, ...word } = input;

      const { data, error } = await ctx.supabase
        .from('vocabulary_words')
        .insert({
          set_id: setId ?? null,
          word: word.word,
          sentence: word.sentence,
          definition: word.definition,
          root: word.root || null,
          charge: word.charge,
          part_of_speech: word.part_of_speech || null,
        })
        .select('id, set_id, word, sentence, definition, root, charge, part_of_speech, created_at')
        .single();

      if (error || !data) {
        console.error('❌ [vocabulary.createWord] Insert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save the word' });
      }

      return { success: true, word: data };
    }),

  updateWord: protectedProcedure
    .input(vocabularyWordSchema.partial().extend({ wordId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { wordId, ...changes } = input;

      const patch = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );

      if (Object.keys(patch).length === 0) {
        return { success: true, updated: false };
      }

      const { error } = await ctx.supabase.from('vocabulary_words').update(patch).eq('id', wordId);

      if (error) {
        console.error('❌ [vocabulary.updateWord] Update failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not update the word' });
      }

      return { success: true, updated: true };
    }),

  deleteWord: protectedProcedure
    .input(z.object({ wordId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('vocabulary_words').delete().eq('id', input.wordId);

      if (error) {
        console.error('❌ [vocabulary.deleteWord] Delete failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the word' });
      }

      return { success: true };
    }),

  /**
   * Record one drill attempt. `charge_correct` is computed server-side by
   * comparing the guess against the stored charge — the client never asserts
   * its own correctness, and the answer isn't revealed before the write.
   */
  recordAttempt: protectedProcedure
    .input(
      z.object({
        wordId: z.string().uuid(),
        guessedCharge: wordChargeSchema,
        guessedMeaning: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase } = ctx;

      const { data: word, error: wordError } = await supabase
        .from('vocabulary_words')
        .select('id, charge, definition, root')
        .eq('id', input.wordId)
        .single();

      if (wordError || !word) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Word not found' });
      }

      const chargeCorrect = word.charge === input.guessedCharge;

      const { error } = await supabase.from('vocabulary_attempts').insert({
        word_id: input.wordId,
        guessed_charge: input.guessedCharge,
        guessed_meaning: input.guessedMeaning ?? null,
        charge_correct: chargeCorrect,
      });

      if (error) {
        console.error('❌ [vocabulary.recordAttempt] Insert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not record your attempt' });
      }

      // The reveal payload is returned only after the guess is committed.
      return {
        success: true,
        chargeCorrect,
        actualCharge: word.charge,
        definition: word.definition,
        root: word.root,
      };
    }),

  /** Per-word accuracy for the drill, weakest first. */
  attemptStats: protectedProcedure
    .input(z.object({ setId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from('vocabulary_attempts')
        .select('word_id, charge_correct, vocabulary_words!inner ( word, set_id )');

      if (input?.setId) query = query.eq('vocabulary_words.set_id', input.setId);

      const { data, error } = await query;

      if (error) {
        console.error('❌ [vocabulary.attemptStats] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your vocabulary stats' });
      }

      const buckets = new Map<string, { word: string; attempts: number; correct: number }>();
      for (const row of data ?? []) {
        const w = row.vocabulary_words as unknown as { word: string } | null;
        const b = buckets.get(row.word_id) ?? { word: w?.word ?? '', attempts: 0, correct: 0 };
        b.attempts += 1;
        if (row.charge_correct) b.correct += 1;
        buckets.set(row.word_id, b);
      }

      return Array.from(buckets.entries())
        .map(([wordId, b]) => ({
          wordId,
          word: b.word,
          attempts: b.attempts,
          correct: b.correct,
          accuracyPercent: b.attempts === 0 ? 0 : Math.round((b.correct / b.attempts) * 1000) / 10,
        }))
        .sort((a, b) => a.accuracyPercent - b.accuracyPercent);
    }),
});
