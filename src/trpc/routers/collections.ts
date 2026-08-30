import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';

/**
 * Bookmarked-question collections.
 *
 * A user saves any question into named, colored folders (or leaves it
 * "Unsorted", folder_id null) and can later re-do a folder as an untimed set.
 * RLS scopes every table to the caller, so these queries never filter by user
 * beyond what the policies already enforce; the explicit `user_id` on writes
 * satisfies the insert checks and keeps the rows unambiguous.
 *
 * Question rows are read with the same safe column set the taker uses, so a
 * folder's questions drop straight into <UntimedTaker>.
 */

const SAFE_QUESTION_COLUMNS =
  'id, external_id, position, passage, question_text, options, has_visual, visual_data, visual_url, domain, skill, difficulty, section, answer_format';

const FOLDER_COLORS = ['blue', 'rose', 'green', 'amber', 'violet', 'cyan', 'slate'] as const;
const colorSchema = z.enum(FOLDER_COLORS);

export const collectionsRouter = createTRPCRouter({
  /** Folders (with question counts) plus the count of Unsorted bookmarks. */
  listFolders: protectedProcedure.query(async ({ ctx }) => {
    const [{ data: folders, error: fErr }, { data: marks, error: mErr }] = await Promise.all([
      ctx.supabase
        .from('question_folders')
        .select('id, name, color, created_at')
        .order('created_at', { ascending: true }),
      ctx.supabase.from('question_bookmarks').select('folder_id'),
    ]);
    if (fErr || mErr) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your collections' });
    }
    const counts = new Map<string, number>();
    let unsorted = 0;
    for (const m of marks ?? []) {
      if (m.folder_id) counts.set(m.folder_id, (counts.get(m.folder_id) ?? 0) + 1);
      else unsorted += 1;
    }
    return {
      folders: (folders ?? []).map((f) => ({
        id: f.id as string,
        name: f.name as string,
        color: f.color as string,
        createdAt: f.created_at as string,
        count: counts.get(f.id as string) ?? 0,
      })),
      unsortedCount: unsorted,
      totalBookmarks: (marks ?? []).length,
    };
  }),

  createFolder: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(60), color: colorSchema.default('blue') }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('question_folders')
        .insert({ user_id: ctx.user.id, name: input.name, color: input.color })
        .select('id, name, color, created_at')
        .single();
      if (error || !data) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create the folder' });
      }
      return { id: data.id as string, name: data.name as string, color: data.color as string };
    }),

  renameFolder: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60).optional(),
        color: colorSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const changes: Record<string, string> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.color !== undefined) changes.color = input.color;
      if (Object.keys(changes).length === 0) return { success: true };
      const { error } = await ctx.supabase.from('question_folders').update(changes).eq('id', input.id);
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not update the folder' });
      return { success: true };
    }),

  /** Delete a folder; its bookmarks fall back to Unsorted (FK on delete set null). */
  deleteFolder: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('question_folders').delete().eq('id', input.id);
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the folder' });
      return { success: true };
    }),

  /** The folder ids a question is saved in (plus whether it's saved as Unsorted). */
  questionState: protectedProcedure
    .input(z.object({ questionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('question_bookmarks')
        .select('folder_id')
        .eq('question_id', input.questionId);
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not read bookmark' });
      const folderIds = (data ?? []).filter((r) => r.folder_id).map((r) => r.folder_id as string);
      const unsorted = (data ?? []).some((r) => !r.folder_id);
      return { folderIds, unsorted, bookmarked: (data ?? []).length > 0 };
    }),

  /** Save a question (into a folder, or Unsorted when folderId is null). Idempotent. */
  bookmark: protectedProcedure
    .input(z.object({ questionId: z.string().uuid(), folderId: z.string().uuid().nullable().default(null) }))
    .mutation(async ({ ctx, input }) => {
      const existing = ctx.supabase
        .from('question_bookmarks')
        .select('id')
        .eq('question_id', input.questionId);
      const { data: found } = await (input.folderId
        ? existing.eq('folder_id', input.folderId)
        : existing.is('folder_id', null)
      ).maybeSingle();
      if (found) return { success: true, alreadySaved: true };

      const { error } = await ctx.supabase.from('question_bookmarks').insert({
        user_id: ctx.user.id,
        question_id: input.questionId,
        folder_id: input.folderId,
      });
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save the question' });
      return { success: true };
    }),

  /** Remove a question from a folder (or from Unsorted when folderId is null). */
  removeBookmark: protectedProcedure
    .input(z.object({ questionId: z.string().uuid(), folderId: z.string().uuid().nullable().default(null) }))
    .mutation(async ({ ctx, input }) => {
      const del = ctx.supabase.from('question_bookmarks').delete().eq('question_id', input.questionId);
      const { error } = await (input.folderId ? del.eq('folder_id', input.folderId) : del.is('folder_id', null));
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not remove the bookmark' });
      return { success: true };
    }),

  /** The questions saved in a folder (folderId null = Unsorted), ready for the taker. */
  folderQuestions: protectedProcedure
    .input(z.object({ folderId: z.string().uuid().nullable().default(null) }))
    .query(async ({ ctx, input }) => {
      const q = ctx.supabase
        .from('question_bookmarks')
        .select('question_id, created_at')
        .order('created_at', { ascending: true });
      const { data: marks, error } = await (input.folderId
        ? q.eq('folder_id', input.folderId)
        : q.is('folder_id', null));
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load folder' });

      const ids = (marks ?? []).map((m) => m.question_id as string);
      if (ids.length === 0) return { questions: [], folder: null as null | { name: string; color: string } };

      const [{ data: rows, error: qErr }, folderMeta] = await Promise.all([
        ctx.supabase.from('questions').select(SAFE_QUESTION_COLUMNS).in('id', ids),
        input.folderId
          ? ctx.supabase.from('question_folders').select('name, color').eq('id', input.folderId).single()
          : Promise.resolve({ data: null }),
      ]);
      if (qErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load questions' });

      // Preserve the order questions were bookmarked in.
      const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
      const questions = ids.map((id) => byId.get(id)).filter(Boolean);
      const meta = (folderMeta as { data: { name: string; color: string } | null }).data;
      return { questions, folder: meta ? { name: meta.name, color: meta.color } : null };
    }),
});
