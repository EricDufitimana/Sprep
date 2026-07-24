import { initTRPC, TRPCError } from '@trpc/server';
import { cache } from 'react';
import { cookies } from 'next/headers';
import superjson from 'superjson';
import { createClient } from '@/utils/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AppUser = {
  id: string;
  email: string | null;
};

type Context = {
  user: AppUser | null;
  role: string | null;
  /**
   * Per-request, cookie-scoped Supabase client from `utils/supabase/server.ts`.
   * Every query issued through this runs as the calling user, so the RLS
   * policies on question_banks / questions / test_attempts / answers /
   * vocabulary_* / profiles are enforced by the database itself.
   *
   * Never swap this for `utils/supabase/service-role.ts` in a router —
   * that client bypasses RLS and belongs only in edge functions.
   */
  supabase: SupabaseClient | null;
};

export const createTRPCContext = async (): Promise<Context> => {
  // Skip auth during build time
  if (typeof window === 'undefined' && process.env.NEXT_PHASE === 'phase-production-build') {
    console.log('🔧 [Context] Skipping auth during build time');
    return { user: null, role: null, supabase: null };
  }

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log('🔧 [Context] Creating tRPC context');
    console.log('🔧 [Context] Auth user:', user?.id);

    // Allow unauthenticated access for public procedures
    if (authError || !user) {
      console.log('⚠️ [Context] No authenticated user');
      return { user: null, role: null, supabase };
    }

    return {
      user: { id: user.id, email: user.email ?? null },
      role: null,
      supabase,
    };
  } catch (error) {
    console.error('❌ [Context] Error creating context:', error);
    return { user: null, role: null, supabase: null };
  }
};

export const getServerContext = cache(createTRPCContext);

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<Context>().create({
  /**
   * @see https://trpc.io/docs/server/data-transformers
   */
  transformer: superjson,
});

// Base router and procedure helpers
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;
export { t };

// Protected Procedure — narrows `user` and `supabase` to non-null for the
// whole downstream chain, so routers never re-check either.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.supabase) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      user: ctx.user,
      role: ctx.role,
      supabase: ctx.supabase,
    },
  });
});

// Role-gated procedures follow this shape. CRC defines `adminProcedure` and
// `studentProcedure` this way — add yours once `role` is populated above.
//
// export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
//   if (ctx.role !== 'admin') {
//     throw new TRPCError({ code: 'FORBIDDEN' });
//   }
//   return next({ ctx: { user: ctx.user, role: 'admin' as const } });
// });
