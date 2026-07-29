import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { fetchAllRows } from '@/utils/paginate';
import {
  estimateWeightedScaledScore,
  type Difficulty,
  type DomainResponses,
} from '@/utils/scaled-score';
import {
  DSAT_DOMAIN_WEIGHTS,
  DSAT_MODULE_QUESTIONS,
  MATH_DOMAIN_WEIGHTS,
  domainOrderFor,
} from '@/lib/dsat';
import { sectionSchema } from '@/lib/validation';
import { DIAGNOSIS_KEYS } from '@/lib/diagnosis';
import { COMPLETED_ANSWER_FILTER } from './questions';

/** The domain-share weights for a section's scaled-score estimate. */
function weightsFor(section: 'reading_writing' | 'math'): Record<string, number> {
  return section === 'math' ? MATH_DOMAIN_WEIGHTS : DSAT_DOMAIN_WEIGHTS;
}

/** Per-question time budget on the digital SAT R&W (32 min / 27 questions). */
const BUDGET_SECONDS = Math.round((32 * 60) / DSAT_MODULE_QUESTIONS);
/** Below this, a miss reads as a rush/careless slip rather than a knowledge gap. */
const CARELESS_SECONDS = 25;
/** Above this a recorded time is idle/tab-left-open, not real thinking time. */
const MAX_PLAUSIBLE_MS = 300_000; // 5 minutes
const DIAGNOSIS_KEY_SET = new Set<string>(DIAGNOSIS_KEYS);

/** One completed answer joined to the little of its question analytics needs. */
type AnalyticsRow = {
  attempt_id: string | null;
  is_correct: boolean | null;
  selected_answer: string | null;
  time_spent_ms: number | null;
  self_diagnosis: string | null;
  source: string | null;
  questions: { domain: string | null; skill: string | null; difficulty: Difficulty | null } | null;
};

/**
 * Split answer rows into one response bucket per official domain, tagged with
 * that domain's SAT weight — the input to the domain-balanced scaled score.
 * `correctOf` lets callers score "as answered" or a hypothetical (e.g. avoidable
 * misses converted). Rows without a known domain or difficulty are dropped.
 */
function toDomainGroups(
  rows: AnalyticsRow[],
  correctOf: (r: AnalyticsRow) => boolean,
  weights: Record<string, number> = DSAT_DOMAIN_WEIGHTS,
): DomainResponses[] {
  return Object.keys(weights).map((domain) => ({
    domain,
    weight: weights[domain],
    responses: rows
      .filter((r) => r.questions?.domain === domain && r.questions?.difficulty != null)
      .map((r) => ({ difficulty: r.questions!.difficulty as Difficulty, isCorrect: correctOf(r) })),
  }));
}

/** Group rows by a key, returning correct/total/accuracy, dropping null keys. */
function groupAccuracy<T>(rows: T[], keyOf: (r: T) => string | null, correctOf: (r: T) => boolean) {
  const buckets = new Map<string, { correct: number; total: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!key) continue;
    const b = buckets.get(key) ?? { correct: 0, total: 0 };
    b.total += 1;
    if (correctOf(r)) b.correct += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries()).map(([key, b]) => ({
    key,
    correct: b.correct,
    total: b.total,
    accuracyPercent: b.total === 0 ? 0 : Math.round((b.correct / b.total) * 1000) / 10,
  }));
}

/** Ordinary least-squares slope + intercept of y on x. Null if degenerate. */
function linearFit(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null; // all attempts on the same day
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

const DAY_MS = 86_400_000;

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
          section: sectionSchema.default('reading_writing'),
          limit: z.number().int().min(1).max(50).default(6),
          /** Ignore skills with too little evidence to be meaningful. */
          minAnswered: z.number().int().min(1).max(100).default(3),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 6;
      const minAnswered = input?.minAnswered ?? 3;
      const section = input?.section ?? 'reading_writing';

      const { data, error } = await ctx.supabase
        .from('skill_performance')
        .select('domain, skill, total_answered, total_correct, accuracy_percent')
        .eq('user_id', ctx.user.id)
        .in('domain', domainOrderFor(section))
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
  overview: protectedProcedure
    .input(z.object({ section: sectionSchema.default('reading_writing') }).optional())
    .query(async ({ ctx, input }) => {
    const section = input?.section ?? 'reading_writing';
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
          .in('domain', domainOrderFor(section))
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

  /**
   * The whole Progress page in one round trip. Reads every completed answer
   * (bank practice + sittings) joined to its question's difficulty/domain/skill,
   * plus submitted attempts and the profile's goal, then derives:
   *
   *   • an IRT/Rasch estimated R&W scaled score (200–800) with a confidence band
   *   • the "reachable" score if avoidable (easy/rushed) misses were converted
   *   • score-over-time, per attempt, in both % and estimated scaled score
   *   • a projection to the test date vs. the target (are you on pace?)
   *   • accuracy by difficulty, by domain, and weakest skills
   *   • pacing (time vs. the ~71s budget, accuracy by time spent)
   *   • an error split (careless vs. knowledge) and self-diagnosis tallies
   *   • practice mix vs. the official domain weighting
   *
   * Everything is derived here so the client just renders. The scaled score is
   * an ESTIMATE — see utils/scaled-score.ts for the model and its caveats.
   */
  analytics: protectedProcedure.query(async ({ ctx }) => {
    const [rows, attempts, profileRes] = await Promise.all([
      fetchAllRows<AnalyticsRow>(
        (from, to) =>
          ctx.supabase
            .from('answers')
            .select(
              'attempt_id, is_correct, selected_answer, time_spent_ms, self_diagnosis, source, questions ( domain, skill, difficulty )',
            )
            .or(COMPLETED_ANSWER_FILTER)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: AnalyticsRow[] | null; error: unknown }>,
      ),
      ctx.supabase
        .from('test_attempts')
        .select('id, score_percent, correct_count, total_questions, submitted_at')
        .eq('status', 'submitted')
        .not('submitted_at', 'is', null)
        .order('submitted_at', { ascending: true })
        .limit(200),
      ctx.supabase.from('profiles').select('target_score, test_date').eq('id', ctx.user.id).single(),
    ]);

    const attemptRows = (attempts.data ?? []) as {
      id: string;
      score_percent: number | null;
      correct_count: number | null;
      total_questions: number | null;
      submitted_at: string | null;
    }[];
    const profile = (profileRes.data ?? null) as { target_score: number | null; test_date: string | null } | null;

    // Only answered rows drive accuracy; blanks are not evidence of weakness.
    const answered = rows.filter((r) => r.selected_answer !== null);
    const wrong = answered.filter((r) => r.is_correct !== true);
    const withDiff = answered.filter((r) => r.questions?.difficulty != null);

    // ---- Domain-balanced scaled score + "reachable" ---------------------
    // Ability is estimated per domain and combined by each domain's official SAT
    // share, so an uneven practice mix doesn't skew the section estimate.
    const estimate = estimateWeightedScaledScore(toDomainGroups(answered, (r) => r.is_correct === true));

    const reachable = estimateWeightedScaledScore(
      toDomainGroups(answered, (r) => {
        if (r.is_correct === true) return true;
        const secs = r.time_spent_ms != null ? r.time_spent_ms / 1000 : null;
        return r.questions!.difficulty === 'easy' || (secs != null && secs < CARELESS_SECONDS);
      }),
    );
    const scaledScore = estimate
      ? {
          score: estimate.score,
          low: estimate.low,
          high: estimate.high,
          sampleSize: estimate.sampleSize,
          domainsCovered: estimate.domainsCovered,
          domainsTotal: estimate.domainsTotal,
          reachableScore: reachable?.score ?? estimate.score,
          reachableDelta: (reachable?.score ?? estimate.score) - estimate.score,
        }
      : null;

    // ---- Per-attempt trend (percent + estimated scaled) -----------------
    // Each attempt's scaled score uses the same domain-balanced method.
    const rowsByAttempt = new Map<string, AnalyticsRow[]>();
    for (const r of answered) {
      if (!r.attempt_id) continue;
      const list = rowsByAttempt.get(r.attempt_id) ?? [];
      list.push(r);
      rowsByAttempt.set(r.attempt_id, list);
    }
    const trend = attemptRows.map((a) => {
      const est = estimateWeightedScaledScore(toDomainGroups(rowsByAttempt.get(a.id) ?? [], (r) => r.is_correct === true));
      return {
        attemptId: a.id,
        submittedAt: a.submitted_at,
        scorePercent: a.score_percent == null ? 0 : Number(a.score_percent),
        scaledScore: est?.score ?? null,
      };
    });

    // ---- Projection to the test date vs. target -------------------------
    let projection: {
      projectedScore: number;
      onPace: boolean;
      pointsPerWeek: number;
      requiredPerWeek: number | null;
      daysUntilTest: number;
    } | null = null;
    const target = profile?.target_score ?? null;
    const testDate = profile?.test_date ? new Date(profile.test_date) : null;
    const scaledTrend = trend.filter(
      (t): t is typeof t & { scaledScore: number; submittedAt: string } =>
        t.scaledScore != null && t.submittedAt != null,
    );
    if (target != null && testDate && scaledTrend.length >= 2) {
      const daysUntilTest = Math.ceil((testDate.getTime() - Date.now()) / DAY_MS);
      if (daysUntilTest > 0) {
        const t0 = new Date(scaledTrend[0].submittedAt).getTime();
        const fit = linearFit(
          scaledTrend.map((t) => ({ x: (new Date(t.submittedAt).getTime() - t0) / DAY_MS, y: t.scaledScore })),
        );
        if (fit) {
          const testDay = (testDate.getTime() - t0) / DAY_MS;
          const projectedScore = Math.max(200, Math.min(800, Math.round((fit.intercept + fit.slope * testDay) / 10) * 10));
          const current = estimate?.score ?? scaledTrend[scaledTrend.length - 1].scaledScore;
          const weeksUntil = daysUntilTest / 7;
          projection = {
            projectedScore,
            onPace: projectedScore >= target,
            pointsPerWeek: Math.round(fit.slope * 7),
            requiredPerWeek: weeksUntil > 0 ? Math.round((target - current) / weeksUntil) : null,
            daysUntilTest,
          };
        }
      }
    }

    // ---- Difficulty, domain, skill --------------------------------------
    const DIFF_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];
    const byDifficultyRaw = groupAccuracy(withDiff, (r) => r.questions!.difficulty, (r) => r.is_correct === true);
    const byDifficulty = DIFF_ORDER.map(
      (d) => byDifficultyRaw.find((b) => b.key === d) ?? { key: d, correct: 0, total: 0, accuracyPercent: 0 },
    );

    const byDomain = groupAccuracy(answered, (r) => r.questions?.domain ?? null, (r) => r.is_correct === true).sort(
      (a, b) => a.accuracyPercent - b.accuracyPercent,
    );
    const weakestSkills = groupAccuracy(answered, (r) => r.questions?.skill ?? null, (r) => r.is_correct === true)
      .filter((s) => s.total >= 3)
      .sort((a, b) => a.accuracyPercent - b.accuracyPercent);

    // ---- Pacing (every timed answer: bank practice + sittings) ----------
    // Uses the per-question time recorded on ANY answer (question-bank checks
    // included, not just /practice sittings), dropping implausibly long times
    // that are really idle/tab-left-open rather than thinking.
    const timed = answered.filter(
      (r) => r.time_spent_ms != null && r.time_spent_ms > 0 && r.time_spent_ms <= MAX_PLAUSIBLE_MS,
    );
    let pacing: {
      avgSeconds: number;
      medianSeconds: number;
      budgetSeconds: number;
      sampleSize: number;
      buckets: { label: string; correct: number; total: number; accuracyPercent: number }[];
      byType: { skill: string; avgSeconds: number; count: number; accuracyPercent: number }[];
    } | null = null;
    if (timed.length > 0) {
      const secs = timed.map((r) => r.time_spent_ms! / 1000).sort((a, b) => a - b);
      const avg = secs.reduce((s, n) => s + n, 0) / secs.length;
      const median = secs[Math.floor(secs.length / 2)];
      const bucketDefs: { label: string; test: (s: number) => boolean }[] = [
        { label: '< 30s', test: (s) => s < 30 },
        { label: '30–60s', test: (s) => s >= 30 && s < 60 },
        { label: '60–90s', test: (s) => s >= 60 && s < 90 },
        { label: '> 90s', test: (s) => s >= 90 },
      ];
      const buckets = bucketDefs.map((def) => {
        const inBucket = timed.filter((r) => def.test(r.time_spent_ms! / 1000));
        const correct = inBucket.filter((r) => r.is_correct === true).length;
        return {
          label: def.label,
          correct,
          total: inBucket.length,
          accuracyPercent: inBucket.length === 0 ? 0 : Math.round((correct / inBucket.length) * 1000) / 10,
        };
      });

      // Average time per question type (skill) — which types eat the clock.
      const perSkill = new Map<string, { sum: number; count: number; correct: number }>();
      for (const r of timed) {
        const skill = r.questions?.skill;
        if (!skill) continue;
        const b = perSkill.get(skill) ?? { sum: 0, count: 0, correct: 0 };
        b.sum += r.time_spent_ms! / 1000;
        b.count += 1;
        if (r.is_correct === true) b.correct += 1;
        perSkill.set(skill, b);
      }
      const byType = Array.from(perSkill.entries())
        .map(([skill, b]) => ({
          skill,
          avgSeconds: Math.round(b.sum / b.count),
          count: b.count,
          accuracyPercent: Math.round((b.correct / b.count) * 1000) / 10,
        }))
        .sort((a, b) => b.avgSeconds - a.avgSeconds);

      pacing = {
        avgSeconds: Math.round(avg),
        medianSeconds: Math.round(median),
        budgetSeconds: BUDGET_SECONDS,
        sampleSize: timed.length,
        buckets,
        byType,
      };
    }

    // ---- Error split + self-diagnosis tallies ---------------------------
    let missedEasy = 0, careless = 0, knowledge = 0;
    for (const r of wrong) {
      const secs = r.time_spent_ms != null ? r.time_spent_ms / 1000 : null;
      const isEasy = r.questions?.difficulty === 'easy';
      const fast = secs != null && secs < CARELESS_SECONDS;
      if (isEasy) missedEasy += 1;
      if (isEasy || fast) careless += 1;
      else knowledge += 1;
    }
    const diagCounts = new Map<string, number>();
    for (const r of answered) {
      if (r.self_diagnosis && DIAGNOSIS_KEY_SET.has(r.self_diagnosis)) {
        diagCounts.set(r.self_diagnosis, (diagCounts.get(r.self_diagnosis) ?? 0) + 1);
      }
    }
    const diagnosis = Array.from(diagCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    // ---- Practice mix vs. official domain weighting ---------------------
    const domainCounts = new Map<string, number>();
    for (const r of answered) {
      const d = r.questions?.domain;
      if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
    const totalDomainAnswered = Array.from(domainCounts.values()).reduce((s, n) => s + n, 0);
    const practiceMix = (Object.keys(DSAT_DOMAIN_WEIGHTS) as (keyof typeof DSAT_DOMAIN_WEIGHTS)[]).map((domain) => {
      const count = domainCounts.get(domain) ?? 0;
      return {
        domain,
        answered: count,
        share: totalDomainAnswered === 0 ? 0 : Math.round((count / totalDomainAnswered) * 1000) / 10,
        targetShare: Math.round(DSAT_DOMAIN_WEIGHTS[domain] * 1000) / 10,
      };
    });

    return {
      scaledScore,
      target: target != null || testDate ? { targetScore: target, testDate: profile?.test_date ?? null } : null,
      projection,
      trend,
      byDifficulty,
      byDomain,
      weakestSkills,
      pacing,
      errors: { total: wrong.length, careless, knowledge, missedEasy },
      diagnosis,
      practiceMix,
      totals: { answered: answered.length, correct: answered.filter((r) => r.is_correct === true).length },
    };
  }),
});
