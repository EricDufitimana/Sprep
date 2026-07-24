import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { profileUpdateSchema } from '@/lib/validation';
import { avatarById, isKnownAvatarId } from '@/lib/avatars';

/**
 * Profile read/write plus onboarding.
 *
 * `profiles.id` is the auth user id (FK straight to auth.users), so there is no
 * separate user_id column to filter on — the row is addressed by ctx.user.id.
 *
 * Avatars are a fixed preset set (see `lib/avatars.ts`), hotlinked from jsDelivr.
 * The client sends only an `avatar_id`; the URL is looked up server-side and
 * stored alongside it, so `avatar_url` is always a value this app chose.
 */

export const profileRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('profiles')
      .select('id, username, display_name, avatar_id, avatar_url, target_score, test_date, onboarded, created_at, updated_at')
      .eq('id', ctx.user.id)
      .maybeSingle();

    if (error) {
      console.error('❌ [profile.get] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your profile' });
    }

    // A user can exist in auth before their profile row does.
    if (!data) {
      return {
        id: ctx.user.id,
        email: ctx.user.email,
        username: null,
        display_name: null,
        avatar_id: null,
        avatar_url: null,
        target_score: null,
        test_date: null,
        onboarded: false,
        exists: false,
      };
    }

    return {
      ...data,
      email: ctx.user.email,
      avatar_url: data.avatar_url,
      exists: true,
    };
  }),

  update: protectedProcedure
    .input(profileUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      // Usernames are globally unique; check first so the user gets a readable
      // message instead of a raw constraint violation.
      if (input.username) {
        const { data: taken } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', input.username)
          .neq('id', user.id)
          .maybeSingle();

        if (taken) {
          throw new TRPCError({ code: 'CONFLICT', message: 'That username is already taken' });
        }
      }

      // Changing the avatar goes through the same preset guard as onboarding:
      // an id must be one of the known presets, and its URL is derived here
      // rather than trusted from the client.
      let avatarPatch: { avatar_id?: string; avatar_url?: string } = {};
      if (input.avatar_id !== undefined) {
        const preset = avatarById(input.avatar_id);
        if (!preset) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick an avatar from the set' });
        }
        avatarPatch = { avatar_id: preset.id, avatar_url: preset.url };
      }

      const patch = Object.fromEntries(
        Object.entries({
          username: input.username,
          display_name: input.display_name,
          ...avatarPatch,
          target_score: input.target_score,
          test_date: input.test_date,
        }).filter(([, v]) => v !== undefined),
      );

      if (Object.keys(patch).length === 0) {
        return { success: true, updated: false };
      }

      // Upsert so a first-time save creates the row rather than failing.
      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          { id: user.id, ...patch, updated_at: new Date().toISOString() },
          { onConflict: 'id' },
        )
        .select('id, username, display_name, avatar_id, avatar_url, target_score, test_date, onboarded')
        .single();

      if (error || !data) {
        console.error('❌ [profile.update] Upsert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save your profile' });
      }

      return {
        success: true,
        updated: true,
        profile: data,
      };
    }),

  completeOnboarding: protectedProcedure
    .input(
      z.object({
        display_name: z.string().min(1, { message: 'Display name is required' }).max(80),
        target_score: z.number().int().min(400).max(1600).optional(),
        test_date: z.string().date('Test date must be a valid date').optional(),
        // Only ids from the fixed preset set are accepted — the client cannot
        // save an arbitrary remote URL as its avatar.
        avatar_id: z
          .string()
          .refine(isKnownAvatarId, { message: 'Pick an avatar from the set' })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preset = input.avatar_id ? avatarById(input.avatar_id) : undefined;

      const { data, error } = await ctx.supabase
        .from('profiles')
        .upsert(
          {
            id: ctx.user.id,
            display_name: input.display_name,
            target_score: input.target_score ?? null,
            test_date: input.test_date ?? null,
            avatar_id: preset?.id ?? null,
            // Preset avatars are hotlinked, so the resolved URL is stored
            // alongside the id rather than rebuilt on every read.
            avatar_url: preset?.url ?? null,
            onboarded: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
        .select('id, display_name, avatar_id, avatar_url, target_score, test_date, onboarded')
        .single();

      if (error || !data) {
        console.error('❌ [profile.completeOnboarding] Upsert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not complete setup' });
      }

      return {
        success: true,
        profile: data,
      };
    }),
});
