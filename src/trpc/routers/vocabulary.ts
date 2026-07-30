import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTRPCRouter, protectedProcedure } from '../init';
import { FREE_RESPONSE_PASS_SCORE } from '@/lib/validation';

/**
 * The vocabulary learning module: a shared corpus of morphemes (roots, prefixes,
 * suffixes) and curated words, plus three graded exercise types.
 *
 * Two of the three exercises are auto-graded with no AI cost — multiple choice
 * and decode-the-word are simple correct/incorrect checks. Only free-response
 * definition grading calls the AI, via the grade_vocab_answer edge function.
 *
 * Every generator returns a question WITHOUT its answer, and grading is always
 * re-derived server-side from the database — the "commit before reveal"
 * principle the rest of the app follows. The corpus itself is open study
 * material (the Learn tab shows every meaning), so this is about not spoiling an
 * in-progress attempt, and about keeping the *log* of correctness honest: the
 * client never asserts whether it was right.
 */

type MorphemeType = 'root' | 'prefix' | 'suffix';
type Charge = 'positive' | 'negative' | 'neutral';

interface MorphemeRow {
  id: string;
  type: MorphemeType;
  text: string;
  meaning: string;
  meaning_group: string;
  charge: Charge | null;
  example_words: string[];
}

const TYPE_LABEL: Record<MorphemeType, string> = {
  root: 'root',
  prefix: 'prefix',
  suffix: 'suffix',
};

/** Fisher–Yates, returns a new array. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** n distinct values from `pool` excluding anything in `exclude`. */
function distractors(pool: string[], exclude: Set<string>, n: number): string[] {
  const seen = new Set(exclude);
  const out: string[] = [];
  for (const v of shuffle(pool)) {
    if (out.length >= n) break;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function loadMorphemes(supabase: SupabaseClient): Promise<MorphemeRow[]> {
  const { data, error } = await supabase
    .from('morphemes')
    .select('id, type, text, meaning, meaning_group, charge, example_words');

  if (error) {
    console.error('❌ [vocabulary.loadMorphemes] Query failed:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load morphemes' });
  }
  return (data ?? []) as unknown as MorphemeRow[];
}

export const vocabularyRouter = createTRPCRouter({
  /** The shared morpheme corpus for the Learn tab, grouped by meaning-family. */
  listMorphemes: protectedProcedure.query(async ({ ctx }) => {
    const rows = await loadMorphemes(ctx.supabase);

    // Preserve the reference doc's ordering: group by meaning_group, prefixes
    // before roots before suffixes within the flat list the client regroups.
    const groups = new Map<string, MorphemeRow[]>();
    for (const m of rows) {
      const list = groups.get(m.meaning_group) ?? [];
      list.push(m);
      groups.set(m.meaning_group, list);
    }

    return Array.from(groups.entries()).map(([group, morphemes]) => ({
      group,
      morphemes: morphemes.map((m) => ({
        id: m.id,
        type: m.type,
        text: m.text,
        meaning: m.meaning,
        charge: m.charge,
        exampleWords: m.example_words ?? [],
      })),
    }));
  }),

  // ── (a) Multiple choice — auto-graded, no AI ──────────────────────────────

  /**
   * A fresh MC question. Two shapes, chosen at random:
   *   • 'meaning' — "What does the root 'loqu' mean?" (options are meanings)
   *   • 'piece'   — "Which root means 'speak'?"       (options are morphemes)
   * The correct option is never marked; gradeMc re-derives it.
   */
  mcQuestion: protectedProcedure.query(async ({ ctx }) => {
    const rows = await loadMorphemes(ctx.supabase);
    if (rows.length < 4) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Not enough morphemes seeded yet' });
    }

    const target = pick(rows);
    const kind: 'meaning' | 'piece' = Math.random() < 0.5 ? 'meaning' : 'piece';

    if (kind === 'meaning') {
      const options = shuffle([
        target.meaning,
        ...distractors(rows.map((r) => r.meaning), new Set([target.meaning]), 3),
      ]);
      return {
        morphemeId: target.id,
        kind,
        prompt: `What does the ${TYPE_LABEL[target.type]} “${target.text}” mean?`,
        options,
      };
    }

    // 'piece': prefer same-type distractors so the choice is about meaning, not
    // about spotting the odd word shape.
    const sameType = rows.filter((r) => r.type === target.type).map((r) => r.text);
    const pool = sameType.length >= 4 ? sameType : rows.map((r) => r.text);
    const options = shuffle([
      target.text,
      ...distractors(pool, new Set([target.text]), 3),
    ]);
    return {
      morphemeId: target.id,
      kind,
      prompt: `Which ${TYPE_LABEL[target.type]} means “${target.meaning}”?`,
      options,
    };
  }),

  gradeMc: protectedProcedure
    .input(
      z.object({
        morphemeId: z.string().uuid(),
        kind: z.enum(['meaning', 'piece']),
        selected: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: m, error } = await ctx.supabase
        .from('morphemes')
        .select('id, text, meaning')
        .eq('id', input.morphemeId)
        .single();

      if (error || !m) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Morpheme not found' });
      }

      const correctAnswer = input.kind === 'meaning' ? m.meaning : m.text;
      const correct = input.selected.trim() === correctAnswer.trim();

      const { error: logError } = await ctx.supabase.from('morpheme_attempts').insert({
        morpheme_id: input.morphemeId,
        exercise_type: 'multiple_choice',
        was_correct: correct,
      });
      if (logError) {
        console.error('❌ [vocabulary.gradeMc] Log failed:', logError);
      }

      // Answer is only revealed after the guess is committed to the log.
      return { correct, correctAnswer };
    }),

  // ── (b) Decode-the-word — auto-graded, no AI ──────────────────────────────

  /**
   * A word built from two known pieces (e.g. "progress" = pro- + gress-),
   * discovered from the seed data itself: a word that appears in two different
   * morphemes' example lists is genuinely decomposable into those pieces. The
   * user picks each piece's meaning and then the glued literal meaning.
   */
  decodeExercise: protectedProcedure.query(async ({ ctx }) => {
    const rows = await loadMorphemes(ctx.supabase);

    // Index every example word to the morphemes that contain it.
    const byWord = new Map<string, MorphemeRow[]>();
    for (const m of rows) {
      for (const w of m.example_words ?? []) {
        const key = w.toLowerCase();
        const list = byWord.get(key) ?? [];
        if (!list.some((x) => x.id === m.id)) list.push(m);
        byWord.set(key, list);
      }
    }

    // Candidates: words made of ≥2 distinct pieces. Order pieces prefix→root→
    // suffix so the chop reads left to right the way the word is built.
    const rank: Record<MorphemeType, number> = { prefix: 0, root: 1, suffix: 2 };
    const candidates = Array.from(byWord.entries())
      .filter(([, ms]) => ms.length >= 2)
      .map(([word, ms]) => ({
        word,
        pieces: [...ms].sort((a, b) => rank[a.type] - rank[b.type]).slice(0, 2),
      }))
      // Drop degenerate pairs whose two pieces mean the same thing (e.g. the
      // prefix "vener-" and the root "vener", both "respect") — nothing to glue.
      .filter((c) => c.pieces[0].meaning !== c.pieces[1].meaning);

    if (candidates.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'No decodable words available yet' });
    }

    const chosen = pick(candidates);
    const meaningPool = rows.map((r) => r.meaning);

    const pieceOptions = chosen.pieces.map((p) =>
      shuffle([p.meaning, ...distractors(meaningPool, new Set([p.meaning]), 3)]),
    );

    // Glued options: the correct literal glue plus swaps with wrong pieces.
    const correctGlued = chosen.pieces.map((p) => p.meaning).join(' + ');
    const wrong = chosen.pieces.map((p) => distractors(meaningPool, new Set(chosen.pieces.map((x) => x.meaning)), 1)[0]);
    const gluedSet = new Set<string>([
      correctGlued,
      `${wrong[0]} + ${chosen.pieces[1].meaning}`,
      `${chosen.pieces[0].meaning} + ${wrong[1]}`,
      `${wrong[0]} + ${wrong[1]}`,
    ]);
    const gluedOptions = shuffle(Array.from(gluedSet));

    return {
      word: chosen.word,
      pieces: chosen.pieces.map((p) => ({ id: p.id, text: p.text, type: p.type })),
      pieceOptions, // pieceOptions[i] is the dropdown for pieces[i]
      gluedOptions,
    };
  }),

  gradeDecode: protectedProcedure
    .input(
      z.object({
        items: z
          .array(z.object({ morphemeId: z.string().uuid(), selectedMeaning: z.string().min(1) }))
          .min(1)
          .max(3),
        selectedGlued: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ids = input.items.map((i) => i.morphemeId);
      const { data, error } = await ctx.supabase
        .from('morphemes')
        .select('id, meaning')
        .in('id', ids);

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Morphemes not found' });
      }

      const meaningById = new Map(data.map((m) => [m.id, m.meaning as string]));

      const pieces = input.items.map((item) => {
        const truth = meaningById.get(item.morphemeId) ?? '';
        return {
          morphemeId: item.morphemeId,
          correct: item.selectedMeaning.trim() === truth.trim(),
          correctMeaning: truth,
        };
      });

      // The glue is re-derived in the submitted piece order.
      const correctGlued = input.items.map((i) => meaningById.get(i.morphemeId) ?? '').join(' + ');
      const gluedCorrect = input.selectedGlued.trim() === correctGlued.trim();

      // One attempt row per piece, so progress can attribute a decode miss to
      // the specific root/prefix family it belongs to.
      const rows = pieces.map((p) => ({
        morpheme_id: p.morphemeId,
        exercise_type: 'decode' as const,
        was_correct: p.correct && gluedCorrect,
      }));
      const { error: logError } = await ctx.supabase.from('morpheme_attempts').insert(rows);
      if (logError) {
        console.error('❌ [vocabulary.gradeDecode] Log failed:', logError);
      }

      return { pieces, gluedCorrect, correctGlued };
    }),

  // ── (c) Free-response definition — AI-graded ──────────────────────────────

  /** A word to define in your own words. Definition is withheld until grading. */
  freeResponseWord: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('vocabulary_words')
      .select('id, word, part_of_speech')
      .eq('is_default', true)
      .not('definition', 'is', null);

    if (error) {
      console.error('❌ [vocabulary.freeResponseWord] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load a word' });
    }
    if (!data || data.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'No words seeded yet' });
    }

    const w = pick(data);
    // Deliberately no definition/charge — the user commits before the reveal.
    return { wordId: w.id, word: w.word, partOfSpeech: w.part_of_speech as string | null };
  }),

  /**
   * Grade a free-response definition through the grade_vocab_answer edge
   * function, persist the AI score to vocabulary_attempts, and return the grade.
   *
   * Grading fires only on explicit submit (the client debounces to submit, not
   * keystrokes). If the AI is unavailable the user still gets the correct
   * definition back — an ungraded reveal beats no feedback at all.
   */
  gradeAnswer: protectedProcedure
    .input(
      z.object({
        wordId: z.string().uuid(),
        userAnswer: z.string().min(1, { message: 'Type a definition first' }).max(600),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: word, error: wordError } = await ctx.supabase
        .from('vocabulary_words')
        .select('id, word, definition, charge')
        .eq('id', input.wordId)
        .single();

      if (wordError || !word || !word.definition) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Word not found' });
      }

      const correctDefinition = word.definition as string;

      // Invoke the isolated grader. Any failure path below still reveals the
      // correct definition, never leaving the user with nothing.
      let graded = false;
      let score: number | null = null;
      let verdict: string | null = null;
      let feedback: string | null = null;

      const { data: result, error: fnError } = await ctx.supabase.functions.invoke('grade_vocab_answer', {
        body: { word: word.word, correctDefinition, userAnswer: input.userAnswer },
      });

      if (fnError || !result || typeof result.score !== 'number') {
        console.error('❌ [vocabulary.gradeAnswer] Grading unavailable:', fnError);
      } else {
        graded = true;
        score = result.score;
        verdict = typeof result.verdict === 'string' ? result.verdict : null;
        feedback = typeof result.feedback === 'string' ? result.feedback : null;
      }

      const wasCorrect = score === null ? null : score >= FREE_RESPONSE_PASS_SCORE;

      const { error: logError } = await ctx.supabase.from('vocabulary_attempts').insert({
        word_id: input.wordId,
        exercise_type: 'free_response',
        user_answer: input.userAnswer,
        ai_score: score,
        ai_verdict: verdict,
        ai_feedback: feedback,
        was_correct: wasCorrect,
      });
      if (logError) {
        console.error('❌ [vocabulary.gradeAnswer] Log failed:', logError);
      }

      return {
        graded,
        score,
        verdict,
        feedback,
        correctDefinition,
        charge: word.charge as Charge | null,
      };
    }),

  // ── Progress: where each meaning-family and exercise type stands ──────────

  /**
   * Accuracy per meaning-group and per exercise type — the vocabulary side of
   * the app's "where I struggle" view. Draws from morpheme_attempts (MC + decode)
   * and free-response attempts on vocabulary_attempts, the latter grouped by the
   * word's linked root.
   */
  progress: protectedProcedure.query(async ({ ctx }) => {
    const [morphemeRes, freeRes] = await Promise.all([
      ctx.supabase
        .from('morpheme_attempts')
        .select('was_correct, exercise_type, morphemes!inner ( meaning_group )'),
      ctx.supabase
        .from('vocabulary_attempts')
        .select('was_correct, exercise_type, vocabulary_words!inner ( morphemes ( meaning_group ) )')
        .eq('exercise_type', 'free_response'),
    ]);

    if (morphemeRes.error || freeRes.error) {
      console.error('❌ [vocabulary.progress] Query failed:', morphemeRes.error ?? freeRes.error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load progress' });
    }

    type Bucket = { attempts: number; correct: number };
    const byGroup = new Map<string, Bucket>();
    const byExercise = new Map<string, Bucket>();

    const bump = (map: Map<string, Bucket>, key: string, correct: boolean | null) => {
      if (correct === null) return; // ungraded (AI failure) — not counted
      const b = map.get(key) ?? { attempts: 0, correct: 0 };
      b.attempts += 1;
      if (correct) b.correct += 1;
      map.set(key, b);
    };

    for (const row of morphemeRes.data ?? []) {
      const group = (row.morphemes as unknown as { meaning_group: string } | null)?.meaning_group;
      bump(byExercise, row.exercise_type as string, row.was_correct as boolean);
      if (group) bump(byGroup, group, row.was_correct as boolean);
    }

    for (const row of freeRes.data ?? []) {
      const word = row.vocabulary_words as unknown as { morphemes: { meaning_group: string } | null } | null;
      const group = word?.morphemes?.meaning_group;
      bump(byExercise, 'free_response', row.was_correct as boolean | null);
      if (group) bump(byGroup, group, row.was_correct as boolean | null);
    }

    const toRows = (map: Map<string, Bucket>) =>
      Array.from(map.entries())
        .map(([key, b]) => ({
          key,
          attempts: b.attempts,
          correct: b.correct,
          accuracyPercent: b.attempts === 0 ? 0 : Math.round((b.correct / b.attempts) * 1000) / 10,
        }))
        .sort((a, b) => a.accuracyPercent - b.accuracyPercent);

    return { byGroup: toRows(byGroup), byExercise: toRows(byExercise) };
  }),
});
