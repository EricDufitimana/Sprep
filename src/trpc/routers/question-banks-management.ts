import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { extractedQuestionSchema, questionBankSchema } from '@/lib/validation';
import { parseAnswerPdf } from '@/utils/question-bank-parser';
import { describeQuestions } from '@/utils/bank-description';

/**
 * Bank lifecycle plus the entry point into AI extraction.
 *
 * Extraction itself runs in the `extract_questions_ai` edge function (service
 * role, AI keys in its own environment). This router only kicks it off, polls
 * the job row, and performs the RLS-scoped bulk insert of whatever comes back.
 */

export const questionBanksManagementRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    // RLS returns the caller's own banks plus every `is_default` one, so the
    // two built-in SAT banks show up for everybody without being duplicated
    // per account. Built-ins sort first so they read as the starting point.
    const { data, error } = await ctx.supabase
      .from('question_banks')
      .select('id, name, description, source_file, total_questions, is_default, created_at')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ [questionBanks.list] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your banks' });
    }

    // Per-bank counts by extraction status, so the UI can surface a
    // "3 need review" badge without a second round trip.
    const bankIds = (data ?? []).map((b) => b.id);
    const counts = new Map<string, { verified: number; needs_review: number; skipped: number }>();

    if (bankIds.length > 0) {
      const { data: rows } = await ctx.supabase
        .from('questions')
        .select('bank_id, extraction_status')
        .in('bank_id', bankIds);

      for (const row of rows ?? []) {
        const c = counts.get(row.bank_id) ?? { verified: 0, needs_review: 0, skipped: 0 };
        c[row.extraction_status as keyof typeof c] += 1;
        counts.set(row.bank_id, c);
      }
    }

    // How many questions in each bank this user has already answered. This is
    // what the card's progress bar reflects — coverage of the bank, not how
    // much of it parsed cleanly.
    const attempted = new Map<string, number>();
    if (bankIds.length > 0) {
      const { data: rows } = await ctx.supabase
        .from('answers')
        .select('question_id, selected_answer, questions!inner ( bank_id ), test_attempts!inner ( status )')
        .not('selected_answer', 'is', null)
        // An abandoned sitting isn't progress — only submitted work counts.
        .eq('test_attempts.status', 'submitted');

      const seen = new Map<string, Set<string>>();
      for (const row of rows ?? []) {
        const bankId = (row.questions as unknown as { bank_id: string } | null)?.bank_id;
        if (!bankId) continue;
        const set = seen.get(bankId) ?? new Set<string>();
        set.add(row.question_id);
        seen.set(bankId, set);
      }
      for (const [bankId, set] of Array.from(seen.entries())) attempted.set(bankId, set.size);
    }

    return (data ?? []).map((b) => ({
      ...b,
      counts: counts.get(b.id) ?? { verified: 0, needs_review: 0, skipped: 0 },
      attempted: attempted.get(b.id) ?? 0,
    }));
  }),

  /**
   * Everything the bank detail page shows: headline stats, the sitting log,
   * and per-question performance so a student can see exactly what they keep
   * getting wrong.
   */
  stats: protectedProcedure
    .input(z.object({ bankId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: bank, error: bankError } = await supabase
        .from('question_banks')
        .select('id, name, description, total_questions, is_default, created_at')
        .eq('id', input.bankId)
        .single();

      if (bankError || !bank) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question bank not found' });
      }

      const { data: questions } = await supabase
        .from('questions')
        .select('id, external_id, position, question_text, passage, options, correct_answer, explanation, visual_url, visual_data, skill, domain, difficulty, extraction_status')
        .eq('bank_id', input.bankId)
        .order('position', { ascending: true, nullsFirst: false });

      const { data: attempts } = await supabase
        .from('test_attempts')
        .select('id, status, score_percent, correct_count, total_questions, time_used_seconds, was_timed, started_at, submitted_at')
        .eq('bank_id', input.bankId)
        .order('started_at', { ascending: false });

      // The log below lists every attempt, including unfinished ones, but
      // per-question performance is computed from submitted sittings alone.
      const attemptIds = (attempts ?? [])
        .filter((a) => a.status === 'submitted')
        .map((a) => a.id);
      const { data: answers } = attemptIds.length
        ? await supabase
            .from('answers')
            .select('question_id, selected_answer, is_correct, flagged, attempt_id')
            .in('attempt_id', attemptIds)
        : { data: [] };

      // Per-question history across every sitting of this bank.
      const perQuestion = new Map<string, { seen: number; correct: number; flagged: number }>();
      for (const a of answers ?? []) {
        if (a.selected_answer === null) continue;
        const rec = perQuestion.get(a.question_id) ?? { seen: 0, correct: 0, flagged: 0 };
        rec.seen += 1;
        if (a.is_correct) rec.correct += 1;
        if (a.flagged) rec.flagged += 1;
        perQuestion.set(a.question_id, rec);
      }

      const verified = (questions ?? []).filter((q) => q.extraction_status === 'verified');
      const submitted = (attempts ?? []).filter((a) => a.status === 'submitted');
      const scores = submitted.map((a) => Number(a.score_percent ?? 0));

      // The last answer given per question, so review can show what was picked.
      const lastPick = new Map<string, string | null>();
      for (const a of answers ?? []) {
        if (a.selected_answer !== null && !lastPick.has(a.question_id)) {
          lastPick.set(a.question_id, a.selected_answer);
        }
      }

      const questionRows = verified.map((q) => {
        const rec = perQuestion.get(q.id);
        const seen = rec?.seen ?? 0;

        return {
          id: q.id,
          externalId: q.external_id,
          position: q.position,
          questionText: q.question_text,
          skill: q.skill,
          domain: q.domain,
          difficulty: q.difficulty,
          seen,
          correct: rec?.correct ?? 0,
          missed: rec ? rec.seen - rec.correct : 0,
          flagged: rec?.flagged ?? 0,
          accuracyPercent: seen > 0 ? Math.round(((rec?.correct ?? 0) / seen) * 100) : null,

          // ═══ Spoiler guard ═══
          // Full detail — including the correct answer — is returned only for
          // questions this user has already answered. An unattempted question
          // gives up nothing, so browsing the log can't spoil a future sitting.
          detail:
            seen > 0
              ? {
                  passage: q.passage,
                  options: q.options,
                  correctAnswer: q.correct_answer,
                  explanation: q.explanation,
                  visualUrl: q.visual_url,
                  visualData: q.visual_data,
                  yourAnswer: lastPick.get(q.id) ?? null,
                }
              : null,
        };
      });

      const attemptedCount = questionRows.filter((r) => r.seen > 0).length;

      return {
        bank: {
          ...bank,
          verifiedCount: verified.length,
          attemptedCount,
          remainingCount: verified.length - attemptedCount,
        },
        summary: {
          sittings: submitted.length,
          bestScorePercent: scores.length ? Math.max(...scores) : null,
          latestScorePercent: scores.length ? scores[0] : null,
          averageScorePercent: scores.length
            ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
            : null,
        },
        attempts: (attempts ?? []).map((a) => ({
          id: a.id,
          status: a.status,
          scorePercent: a.score_percent === null ? null : Number(a.score_percent),
          correctCount: a.correct_count,
          totalQuestions: a.total_questions,
          timeUsedSeconds: a.time_used_seconds,
          timed: a.was_timed,
          startedAt: a.started_at,
          submittedAt: a.submitted_at,
        })),
        questions: questionRows,
        // Ordered worst-first: what to drill next.
        missed: questionRows
          .filter((r) => r.missed > 0)
          .sort((a, b) => b.missed - a.missed || (a.accuracyPercent ?? 0) - (b.accuracyPercent ?? 0)),
        userId: user.id,
      };
    }),

  get: protectedProcedure
    .input(z.object({ bankId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('question_banks')
        .select('id, name, description, source_file, total_questions, created_at')
        .eq('id', input.bankId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question bank not found' });
      }
      return data;
    }),

  create: protectedProcedure
    .input(questionBankSchema)
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('question_banks')
        .insert({
          name: input.name,
          description: input.description || null,
          source_file: input.source_file || null,
          total_questions: 0,
        })
        .select('id, name, description, source_file, total_questions, created_at')
        .single();

      if (error || !data) {
        console.error('❌ [questionBanks.create] Insert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create the bank' });
      }

      return { success: true, bank: data };
    }),

  delete: protectedProcedure
    .input(z.object({ bankId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Built-ins are shared, so deleting one would remove it for everyone.
      const { data: bank } = await ctx.supabase
        .from('question_banks')
        .select('id, is_default')
        .eq('id', input.bankId)
        .single();

      if (bank?.is_default) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Built-in banks cannot be deleted',
        });
      }

      // Questions and attempts cascade from the FK definitions.
      const { error } = await ctx.supabase
        .from('question_banks')
        .delete()
        .eq('id', input.bankId);

      if (error) {
        console.error('❌ [questionBanks.delete] Delete failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete the bank' });
      }

      return { success: true };
    }),

  /**
   * Build a bank from a single College Board "Answers" export PDF.
   *
   * That export already contains the correct answer and rationale for every
   * question, so there is no separate answer key to upload and no AI pass to
   * verify against — the parse either finds a complete, structurally valid
   * question or it reports it as a problem. Everything parsed lands as
   * `verified`; anything that didn't parse is surfaced, not silently dropped.
   *
   * Runs inline rather than as a background job: parsing is pure CPU on an
   * already-uploaded file and completes in well under a request timeout.
   */
  createFromPdf: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, { message: 'Name is required' }).max(120),
        description: z.string().max(500).optional(),
        /** Storage path in `question-papers` the client just uploaded to. */
        sourcePath: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      // RLS on the bucket restricts this to the caller's own prefix.
      const { data: file, error: downloadError } = await supabase.storage
        .from('question-papers')
        .download(input.sourcePath);

      if (downloadError || !file) {
        console.error('❌ [questionBanks.createFromPdf] Download failed:', downloadError);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Could not read that upload. Try uploading it again.',
        });
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      let parsed;
      try {
        parsed = await parseAnswerPdf(buffer);
      } catch (e) {
        console.error('❌ [questionBanks.createFromPdf] Parse threw:', e);
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: 'That PDF could not be read. Is it a College Board answer export?',
        });
      }

      if (parsed.questions.length === 0) {
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message:
            'No questions found in that PDF. It needs to be the "Answers" export — the one containing each question’s correct answer and rationale.',
        });
      }

      // Charts are vector art in the PDF, so they're cropped out and uploaded
      // as PNGs — `visual_data` prose can't be rendered. A failure here must
      // not sink the whole import: the questions are still usable, they just
      // lose their figure, so it's caught and reported rather than thrown.
      const figureUrls = new Map<string, string>();
      try {
        // Imported here, not at module scope. `pdf-figures` pulls in
        // @napi-rs/canvas (a native Skia binding) and pdfjs; at module scope
        // every procedure in this router — profile lookups included — would
        // load them, and any resolution failure would 500 the whole API.
        const { extractFigures, attributeFigures } = await import('@/utils/pdf-figures');
        const { figures, anchors } = await extractFigures(new Uint8Array(buffer));
        const byQuestion = attributeFigures(figures, anchors);

        for (const [externalId, figs] of Array.from(byQuestion.entries())) {
          const path = `${user.id}/${input.sourcePath.split('/').slice(1).join('-')}/${externalId}.png`;
          const { error: figErr } = await supabase.storage
            .from('question-figures')
            .upload(path, figs[0].png, { contentType: 'image/png', upsert: true });

          if (figErr) {
            console.error('⚠️ [questionBanks.createFromPdf] Figure upload failed:', figErr);
            continue;
          }
          const { data: pub } = supabase.storage.from('question-figures').getPublicUrl(path);
          figureUrls.set(externalId, pub.publicUrl);
        }
      } catch (e) {
        console.error('⚠️ [questionBanks.createFromPdf] Figure extraction failed:', e);
      }

      // A bank with no description leaves a hole in the card, so derive one
      // from what actually got parsed when the user didn't write their own.
      const description = input.description?.trim() || describeQuestions(parsed.questions) || null;

      const { data: bank, error: bankError } = await supabase
        .from('question_banks')
        .insert({
          name: input.name,
          description,
          source_file: input.sourcePath,
          total_questions: parsed.questions.length,
        })
        .select('id')
        .single();

      if (bankError || !bank) {
        console.error('❌ [questionBanks.createFromPdf] Bank insert failed:', bankError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create the bank' });
      }

      const rows = parsed.questions.map((q) => ({
        bank_id: bank.id,
        user_id: user.id,
        external_id: q.external_id,
        position: q.position,
        domain: q.domain,
        skill: q.skill,
        difficulty: q.difficulty,
        passage: q.passage,
        question_text: q.question_text,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        has_visual: figureUrls.has(q.external_id),
        visual_data: null,
        visual_url: figureUrls.get(q.external_id) ?? null,
        // The source document is the ground truth, so a clean parse is verified.
        extraction_status: 'verified' as const,
      }));

      const { error: insertError } = await supabase.from('questions').insert(rows);

      if (insertError) {
        console.error('❌ [questionBanks.createFromPdf] Question insert failed:', insertError);
        // Don't leave an empty bank behind.
        await supabase.from('question_banks').delete().eq('id', bank.id);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not save the extracted questions',
        });
      }

      return {
        success: true,
        bankId: bank.id,
        verified: rows.length,
        figures: figureUrls.size,
        problems: parsed.problems,
      };
    }),

  /**
   * Kick off extraction. Creates the bank and an `extraction_jobs` row, then
   * invokes the edge function without awaiting it — extraction of a full paper
   * runs well past a request timeout, so the client polls `getExtractionStatus`.
   *
   * The function writes its own results back using the service role; this
   * procedure's job ends once the job row exists.
   *
   * Kept for scanned papers that aren't answer exports; `createFromPdf` is the
   * path the upload UI uses.
   */
  createFromExtraction: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        /** Storage paths of rendered page images, or a single PDF path. */
        sourcePaths: z.array(z.string().min(1)).min(1).max(100),
        /** Ground truth used to cross-check every extracted answer. */
        answerKey: z
          .array(z.object({ position: z.number().int().min(1), correct_answer: z.string().length(1) }))
          .min(1),
        onVisualFailure: z.enum(['skip', 'review']).default('skip'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase } = ctx;

      const { data: bank, error: bankError } = await supabase
        .from('question_banks')
        .insert({
          name: input.name,
          description: input.description || null,
          source_file: input.sourcePaths[0],
          total_questions: 0,
        })
        .select('id')
        .single();

      if (bankError || !bank) {
        console.error('❌ [questionBanks.createFromExtraction] Bank insert failed:', bankError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create the bank' });
      }

      const { data: job, error: jobError } = await supabase
        .from('extraction_jobs')
        .insert({
          bank_id: bank.id,
          status: 'queued',
          total_pages: input.sourcePaths.length,
          pages_done: 0,
        })
        .select('id')
        .single();

      if (jobError || !job) {
        console.error('❌ [questionBanks.createFromExtraction] Job insert failed:', jobError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not queue extraction' });
      }

      // Fire and forget. `functions.invoke` forwards the caller's JWT, which the
      // function uses to attribute inserted rows to this user.
      void supabase.functions
        .invoke('extract_questions_ai', {
          body: {
            jobId: job.id,
            bankId: bank.id,
            sourcePaths: input.sourcePaths,
            answerKey: input.answerKey,
            config: { onVisualFailure: input.onVisualFailure },
          },
        })
        .catch((err) => {
          console.error('❌ [questionBanks.createFromExtraction] Invoke failed:', err);
        });

      return { success: true, bankId: bank.id, jobId: job.id };
    }),

  getExtractionStatus: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('extraction_jobs')
        .select('id, bank_id, status, total_pages, pages_done, questions_found, verified_count, needs_review_count, skipped_count, error_message, started_at, finished_at')
        .eq('id', input.jobId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extraction job not found' });
      }

      return {
        ...data,
        progressPercent:
          data.total_pages && data.total_pages > 0
            ? Math.round(((data.pages_done ?? 0) / data.total_pages) * 100)
            : 0,
      };
    }),

  /**
   * Bulk-insert verified/flagged questions produced by extraction, through the
   * RLS-scoped client. Used when the edge function returns results to the
   * client for confirmation rather than writing them itself.
   */
  insertExtractedQuestions: protectedProcedure
    .input(
      z.object({
        bankId: z.string().uuid(),
        questions: z.array(extractedQuestionSchema).min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { supabase, user } = ctx;

      const { data: bank, error: bankError } = await supabase
        .from('question_banks')
        .select('id, user_id')
        .eq('id', input.bankId)
        .single();

      if (bankError || !bank) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question bank not found' });
      }
      if (bank.user_id !== user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'That question bank is not yours' });
      }

      const rows = input.questions.map((q) => ({
        bank_id: input.bankId,
        user_id: user.id,
        external_id: q.external_id ?? null,
        position: q.position,
        domain: q.domain ?? null,
        skill: q.skill ?? null,
        difficulty: q.difficulty ?? null,
        passage: q.passage ?? null,
        question_text: q.question_text,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation ?? null,
        has_visual: q.has_visual,
        visual_data: q.visual_data ?? null,
        extraction_status: q.extraction_status,
      }));

      const { error } = await supabase.from('questions').insert(rows);

      if (error) {
        console.error('❌ [questionBanks.insertExtractedQuestions] Insert failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save the questions' });
      }

      // `total_questions` counts what can actually be sat.
      const verified = rows.filter((r) => r.extraction_status === 'verified').length;
      await supabase
        .from('question_banks')
        .update({ total_questions: verified })
        .eq('id', input.bankId);

      return {
        success: true,
        inserted: rows.length,
        verified,
        needsReview: rows.filter((r) => r.extraction_status === 'needs_review').length,
        skipped: rows.filter((r) => r.extraction_status === 'skipped').length,
      };
    }),
});
