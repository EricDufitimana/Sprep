import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTRPCRouter, protectedProcedure } from '../init';
import { balanceCustom, balanceDsat, type BalanceResult } from '@/utils/module-balance';
import { DSAT_DOMAIN_WEIGHTS, DSAT_MODULE_QUESTIONS } from '@/lib/dsat';
import { domainLabel } from '@/lib/labels';

/**
 * Composed modules: full sections built from several banks.
 *
 * A module stores a recipe (banks + format + counts), not a fixed question set.
 * Selection happens fresh at sitting time (`tests.start`) so repeats are
 * excluded — the shared helpers below are what both the live preview and the
 * eventual sitting use, so what you preview is what you get.
 */

const FORMAT = z.enum(['dsat', 'custom']);

/** A verified, not-yet-seen question with its domain — the selection pool. */
interface PoolQuestion {
  id: string;
  domain: string | null;
}

/**
 * Verified questions across `bankIds` that the user hasn't already answered in
 * a submitted sitting. This is the pool every module draws from, and excluding
 * seen questions here is what makes "do it again → fresh questions" work.
 */
async function freshPool(
  supabase: SupabaseClient,
  userId: string,
  bankIds: string[],
): Promise<PoolQuestion[]> {
  if (bankIds.length === 0) return [];

  const { data: all, error } = await supabase
    .from('questions')
    .select('id, domain')
    .in('bank_id', bankIds)
    .eq('extraction_status', 'verified');

  if (error) {
    console.error('❌ [modules] pool query failed:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not read the banks' });
  }

  const { data: seenRows } = await supabase
    .from('answers')
    .select('question_id, selected_answer, questions!inner ( bank_id ), test_attempts!inner ( status )')
    .in('questions.bank_id', bankIds)
    .not('selected_answer', 'is', null)
    .eq('test_attempts.status', 'submitted');

  const seen = new Set((seenRows ?? []).map((r) => r.question_id));
  return (all ?? []).filter((q) => !seen.has(q.id)) as PoolQuestion[];
}

function countByDomain(pool: PoolQuestion[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of pool) {
    const d = q.domain ?? 'unclassified';
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

/** Fisher–Yates. Kept local so selection is honestly random, not sort-hacked. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Run the recipe against the current pool: returns the balance plan. */
export function planFor(
  format: 'dsat' | 'custom',
  total: number,
  customCounts: Record<string, number> | undefined,
  available: Record<string, number>,
): BalanceResult {
  return format === 'custom' && customCounts
    ? balanceCustom(customCounts, available, domainLabel)
    : balanceDsat(total, available, DSAT_DOMAIN_WEIGHTS);
}

/**
 * Pick the actual question ids for a plan: `plan.byDomain[d]` random questions
 * from each domain, combined and shuffled so domains interleave like a section.
 * Exported for `tests.start`.
 */
export function selectQuestionIds(pool: PoolQuestion[], plan: BalanceResult): string[] {
  const byDomain = new Map<string, PoolQuestion[]>();
  for (const q of pool) {
    const d = q.domain ?? 'unclassified';
    (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(q);
  }

  const picked: string[] = [];
  for (const [domain, want] of Object.entries(plan.byDomain)) {
    const group = shuffle(byDomain.get(domain) ?? []);
    picked.push(...group.slice(0, want).map((q) => q.id));
  }
  return shuffle(picked);
}

const moduleInput = z.object({
  bankIds: z.array(z.string().uuid()).min(1, { message: 'Pick at least one bank' }),
  format: FORMAT,
  /** DSAT: target length. Ignored for custom, whose length is the sum of counts. */
  total: z.number().int().min(1).max(120).default(DSAT_MODULE_QUESTIONS),
  /** Custom: explicit per-domain counts. */
  customCounts: z.record(z.string(), z.number().int().min(0).max(120)).optional(),
});

export const modulesManagementRouter = createTRPCRouter({
  /**
   * Dry-run the recipe against the live pool. Drives the builder's preview so
   * the user sees the real resulting mix — including any shortfall notes —
   * before committing. Read-only.
   */
  previewBalance: protectedProcedure
    .input(moduleInput)
    .query(async ({ ctx, input }) => {
      const pool = await freshPool(ctx.supabase, ctx.user.id, input.bankIds);
      const available = countByDomain(pool);
      const plan = planFor(input.format, input.total, input.customCounts, available);

      return {
        available,
        poolSize: pool.length,
        plan: plan.byDomain,
        total: plan.total,
        balanced: plan.balanced,
        notes: plan.notes,
      };
    }),

  create: protectedProcedure
    .input(moduleInput.extend({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      // Confirm the banks are the caller's own or built-ins, and reachable.
      const { data: banks, error: banksError } = await supabase
        .from('question_banks')
        .select('id, name, is_default, user_id')
        .in('id', input.bankIds);

      if (banksError || !banks || banks.length !== input.bankIds.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more banks could not be found' });
      }
      for (const b of banks) {
        if (!b.is_default && b.user_id !== user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `“${b.name}” is not yours to use` });
        }
      }

      // Snapshot the intended plan against the pool right now. Sitting the
      // module re-plans against the then-current pool, so this is for display.
      const pool = await freshPool(supabase, user.id, input.bankIds);
      const plan = planFor(input.format, input.total, input.customCounts, countByDomain(pool));

      if (plan.total === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No unseen questions match this recipe. Add more banks or reset your history.',
        });
      }

      const { data: mod, error } = await supabase
        .from('modules')
        .insert({
          name: input.name.trim(),
          format: input.format,
          total_questions: plan.total,
          source_bank_ids: input.bankIds,
          plan: plan.byDomain,
        })
        .select('id')
        .single();

      if (error || !mod) {
        console.error('❌ [modules.create] insert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save the module' });
      }

      return { success: true, moduleId: mod.id, plan: plan.byDomain, total: plan.total, notes: plan.notes };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('modules')
      .select('id, name, format, total_questions, source_bank_ids, plan, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ [modules.list] query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your modules' });
    }

    const rows = data ?? [];
    const allBankIds = Array.from(new Set(rows.flatMap((m) => m.source_bank_ids as string[])));

    // Resolve source-bank names once for the "combined from …" description.
    const names = new Map<string, string>();
    if (allBankIds.length > 0) {
      const { data: banks } = await ctx.supabase
        .from('question_banks')
        .select('id, name')
        .in('id', allBankIds);
      for (const b of banks ?? []) names.set(b.id, b.name);
    }

    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      format: m.format as 'dsat' | 'custom',
      totalQuestions: m.total_questions,
      plan: (m.plan ?? {}) as Record<string, number>,
      createdAt: m.created_at,
      sourceBankNames: (m.source_bank_ids as string[]).map((id) => names.get(id) ?? 'Removed bank'),
    }));
  }),

  delete: protectedProcedure
    .input(z.object({ moduleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('modules').delete().eq('id', input.moduleId);
      if (error) {
        console.error('❌ [modules.delete] delete failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the module' });
      }
      return { success: true };
    }),
});
