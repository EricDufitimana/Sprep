import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';

/**
 * Analytics. Everything reads the `skill_performance` view, which is declared
 * `security_invoker` — so it evaluates under the caller's RLS policies and
 * needs no user_id filter of its own (the filter is kept anyway as a backstop).
 *
 * View shape: user_id, domain, skill, total_answered, total_correct, accuracy_percent.
 * It counts only rows where `selected_answer IS NOT NULL`, so blanks don't
 * drag accuracy down — an unanswered question is not evidence of weakness.
 */

export const progressRouter = createTRPCRouter({
  /** The "where you struggle most" panel: least accurate first. */
  weakestSkills: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(6),
          /** Ignore skills with too little evidence to be meaningful. */
          minAnswered: z.number().int().min(1).max(100).default(3),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 6;
      const minAnswered = input?.minAnswered ?? 3;

      const { data, error } = await ctx.supabase
        .from('skill_performance')
        .select('domain, skill, total_answered, total_correct, accuracy_percent')
        .eq('user_id', ctx.user.id)
        .gte('total_answered', minAnswered)
        .order('accuracy_percent', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('❌ [progress.weakestSkills] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your weak areas' });
      }

      return (data ?? []).map((r) => ({
        domain: r.domain,
        skill: r.skill,
        totalAnswered: Number(r.total_answered),
        totalCorrect: Number(r.total_correct),
        accuracyPercent: r.accuracy_percent === null ? 0 : Number(r.accuracy_percent),
      }));
    }),

  /** Score over time, oldest first, submitted attempts only. */
  scoreTrend: protectedProcedure
    .input(z.object({ limit: z.number().int().min(2).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;

      const { data, error } = await ctx.supabase
        .from('test_attempts')
        .select('id, score_percent, submitted_at, total_questions, correct_count, question_banks ( name )')
        .eq('status', 'submitted')
        .not('submitted_at', 'is', null)
        .order('submitted_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('❌ [progress.scoreTrend] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your score history' });
      }

      return (data ?? [])
        .map((a) => ({
          attemptId: a.id,
          submittedAt: a.submitted_at,
          scorePercent: a.score_percent === null ? 0 : Number(a.score_percent),
          correctCount: a.correct_count,
          totalQuestions: a.total_questions,
          bankName: (a.question_banks as unknown as { name: string } | null)?.name ?? 'Untitled bank',
        }))
        .reverse();
    }),

  /** Accuracy rolled up to the four SAT R/W domains. */
  sectionAverages: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('skill_performance')
      .select('domain, total_answered, total_correct')
      .eq('user_id', ctx.user.id);

    if (error) {
      console.error('❌ [progress.sectionAverages] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load section averages' });
    }

    // The view groups by (domain, skill); collapse to domain here rather than
    // averaging the percentages, which would weight small skills equally.
    const buckets = new Map<string, { answered: number; correct: number }>();
    for (const row of data ?? []) {
      if (!row.domain) continue;
      const b = buckets.get(row.domain) ?? { answered: 0, correct: 0 };
      b.answered += Number(row.total_answered);
      b.correct += Number(row.total_correct);
      buckets.set(row.domain, b);
    }

    return Array.from(buckets.entries())
      .map(([domain, b]) => ({
        domain,
        totalAnswered: b.answered,
        totalCorrect: b.correct,
        accuracyPercent: b.answered === 0 ? 0 : Math.round((b.correct / b.answered) * 1000) / 10,
      }))
      .sort((a, b) => a.accuracyPercent - b.accuracyPercent);
  }),

  /** Dashboard summary: latest score, attempt count, average, weakest skill. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [{ data: attempts, error: attemptsError }, { data: weakest, error: weakestError }] =
      await Promise.all([
        ctx.supabase
          .from('test_attempts')
          .select('score_percent, submitted_at')
          .eq('status', 'submitted')
          .order('submitted_at', { ascending: false })
          .limit(50),
        ctx.supabase
          .from('skill_performance')
          .select('domain, skill, total_answered, accuracy_percent')
          .eq('user_id', ctx.user.id)
          .gte('total_answered', 3)
          .order('accuracy_percent', { ascending: true })
          .limit(1),
      ]);

    if (attemptsError || weakestError) {
      console.error('❌ [progress.overview] Query failed:', attemptsError ?? weakestError);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your overview' });
    }

    const scores = (attempts ?? []).map((a) => Number(a.score_percent ?? 0));
    const weak = weakest?.[0];

    return {
      testsTaken: scores.length,
      latestScorePercent: scores.length > 0 ? scores[0] : null,
      averageScorePercent:
        scores.length > 0
          ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
          : null,
      previousScorePercent: scores.length > 1 ? scores[1] : null,
      weakestSkill: weak
        ? {
            domain: weak.domain,
            skill: weak.skill,
            accuracyPercent: weak.accuracy_percent === null ? 0 : Number(weak.accuracy_percent),
            totalAnswered: Number(weak.total_answered),
          }
        : null,
    };
  }),
});
