import { z } from 'zod';
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../init';

/**
 * Reference router — proves the wiring works end to end.
 * Delete once you have real feature routers.
 */
export const healthRouter = createTRPCRouter({
  ping: baseProcedure
    .input(z.object({ name: z.string().min(1) }).optional())
    .query(({ input }) => {
      return {
        ok: true,
        message: `pong${input?.name ? `, ${input.name}` : ''}`,
        at: new Date(),
      };
    }),

  whoami: protectedProcedure.query(({ ctx }) => {
    return {
      user: ctx.user,
      role: ctx.role,
    };
  }),
});
