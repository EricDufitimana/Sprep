import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTRPCRouter, protectedProcedure } from '../init';
import { FREE_RESPONSE_PASS_SCORE } from '@/lib/validation';
import {
  blankSentence,
  buildDistractors,
  classifyTrap,
  type WordRow as SatWordRow,
} from '@/lib/vocab/sat-distractors';

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

/** Flashcard spaced repetition — the same Leitner scheme the Decode Trainer uses. */
const FLASH_MAX_BOX = 5;
const FLASH_LEARN_STREAK = 3;
const FLASH_INTERVAL_DAYS: Record<number, number> = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };

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

interface WordRow {
  id: string;
  word: string;
  definition: string | null;
  charge: Charge | null;
  root_id: string | null;
  part_of_speech: string | null;
  sentence: string | null;
}

/** DB row → the shape the SAT trap engine works on. */
const toSatRow = (r: WordRow): SatWordRow => ({
  word: r.word,
  definition: r.definition ?? '',
  charge: r.charge,
  rootId: r.root_id,
});

/** Every shared (default) word that has a definition — the corpus both the
 *  free-response and sentence-completion generators draw from. */
async function loadDefaultWords(supabase: SupabaseClient): Promise<WordRow[]> {
  const { data, error } = await supabase
    .from('vocabulary_words')
    .select('id, word, definition, charge, root_id, part_of_speech, sentence')
    .eq('is_default', true)
    .not('definition', 'is', null);

  if (error) {
    console.error('❌ [vocabulary.loadDefaultWords] Query failed:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load words' });
  }
  return (data ?? []) as unknown as WordRow[];
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

  // ── (d) Sentence completion — SAT "words in context", auto-graded, no AI ──

  /**
   * A real example sentence with the target word blanked, plus four base-form
   * options. The three wrong options are not filler: each is an SAT-style trap
   * built by @/lib/vocab/sat-distractors — a reversal (opposite meaning), a
   * same-tone lookalike, a topical associate, or an impressive-but-unrelated
   * word. The correct option is never marked; gradeSentenceCompletion re-derives
   * it and only then reveals which trap each wrong option was.
   */
  sentenceCompletion: protectedProcedure.query(async ({ ctx }) => {
    const rows = await loadDefaultWords(ctx.supabase);
    const usable = rows.filter((r) => r.sentence && r.definition && r.part_of_speech);

    if (usable.length < 4) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Not enough words with sentences seeded yet' });
    }

    // Walk candidates in random order until one both blanks cleanly (its sentence
    // really contains the word) and yields a full trap set from its part-of-speech
    // pool. In practice the first candidate almost always works.
    for (const target of shuffle(usable)) {
      const blanked = blankSentence(target.sentence!, target.word);
      if (!blanked) continue;

      const pool = rows
        .filter((r) => r.id !== target.id && r.definition && r.part_of_speech === target.part_of_speech)
        .map(toSatRow);

      const built = buildDistractors(toSatRow(target), pool, target.sentence!);
      if (!built) continue;

      // No answer marker: the four options ship as a flat, shuffled list.
      return {
        wordId: target.id,
        blankedSentence: blanked,
        partOfSpeech: target.part_of_speech,
        options: built.options,
        difficulty: built.difficulty,
      };
    }

    throw new TRPCError({ code: 'NOT_FOUND', message: 'Could not build a sentence-completion item' });
  }),

  gradeSentenceCompletion: protectedProcedure
    .input(
      z.object({
        wordId: z.string().uuid(),
        options: z.array(z.string().min(1)).min(2).max(6),
        selected: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Re-fetch the target (with its sentence) — correctness and the trap
      // explanations are always re-derived server-side, never trusted from the client.
      const { data: target, error: targetError } = await ctx.supabase
        .from('vocabulary_words')
        .select('id, word, definition, charge, root_id, part_of_speech, sentence')
        .eq('id', input.wordId)
        .single();

      if (targetError || !target || !target.definition) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Word not found' });
      }
      const targetRow = target as unknown as WordRow;

      const correct = input.selected.trim().toLowerCase() === targetRow.word.toLowerCase();

      const { error: logError } = await ctx.supabase.from('vocabulary_attempts').insert({
        word_id: targetRow.id,
        exercise_type: 'sentence_completion',
        user_answer: input.selected.trim(),
        was_correct: correct,
      });
      if (logError) {
        console.error('❌ [vocabulary.gradeSentenceCompletion] Log failed:', logError);
      }

      // Pull the option words' rows so each trap can be classified and explained.
      const { data: optionRows } = await ctx.supabase
        .from('vocabulary_words')
        .select('word, definition, charge, root_id')
        .eq('is_default', true)
        .in('word', input.options);

      const rowByWord = new Map<string, SatWordRow>();
      for (const r of (optionRows ?? []) as unknown as WordRow[]) {
        rowByWord.set(r.word.toLowerCase(), toSatRow(r));
      }
      const answerSat = toSatRow(targetRow);
      rowByWord.set(answerSat.word.toLowerCase(), answerSat);

      const sentence = targetRow.sentence ?? '';
      const options = input.options.map((opt) => {
        const row = rowByWord.get(opt.toLowerCase()) ?? { word: opt, definition: '', charge: null, rootId: null };
        const { role, why } = classifyTrap(row, answerSat, sentence);
        return { word: opt, role, why, isAnswer: opt.toLowerCase() === answerSat.word.toLowerCase() };
      });

      return {
        correct,
        correctWord: targetRow.word,
        definition: targetRow.definition ?? '',
        charge: targetRow.charge as Charge | null,
        options,
      };
    }),

  // ── (e) Morpheme flashcards — learn the roots / prefixes / suffixes ────────

  /**
   * The flashcard deck: every shared morpheme joined with this user's private
   * review state, ordered for study — cards due for review first, then never-seen
   * cards, then ones still in progress, with learned cards last.
   */
  flashcardDeck: protectedProcedure
    .input(z.object({ group: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await loadMorphemes(ctx.supabase);
      const { data: stateData, error } = await ctx.supabase
        .from('morpheme_review_state')
        .select('morpheme_id, box, learned, due_at, times_seen');
      if (error) {
        console.error('❌ [vocabulary.flashcardDeck] Query failed:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your flashcards' });
      }

      const stateById = new Map((stateData ?? []).map((s) => [s.morpheme_id as string, s]));
      const now = Date.now();
      const filtered = input?.group ? rows.filter((m) => m.meaning_group === input.group) : rows;

      const cards = filtered.map((m) => {
        const st = stateById.get(m.id);
        return {
          id: m.id,
          type: m.type,
          text: m.text,
          meaning: m.meaning,
          group: m.meaning_group,
          charge: m.charge,
          exampleWords: m.example_words ?? [],
          box: (st?.box as number | undefined) ?? 0,
          learned: (st?.learned as boolean | undefined) ?? false,
          seen: !!st,
          due: st ? new Date(st.due_at as string).getTime() <= now : true,
        };
      });

      // due-unlearned (0) → unseen (1) → in-progress (2) → learned (3)
      const rank = (c: (typeof cards)[number]) => (c.learned ? 3 : !c.seen ? 1 : c.due ? 0 : 2);
      cards.sort((a, b) => rank(a) - rank(b));
      return cards;
    }),

  /**
   * Record a flashcard self-review. "Knew it" advances the Leitner box; "still
   * learning" resets it to box 1. A card is learned after 3 in a row (or box 5).
   */
  reviewFlashcard: protectedProcedure
    .input(z.object({ morphemeId: z.string().uuid(), knew: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from('morpheme_review_state')
        .select('id, box, consecutive_correct, times_seen, times_correct')
        .eq('morpheme_id', input.morphemeId)
        .maybeSingle();

      const prevBox = existing?.box ?? 1;
      const prevStreak = existing?.consecutive_correct ?? 0;
      const box = input.knew ? Math.min(prevBox + 1, FLASH_MAX_BOX) : 1;
      const streak = input.knew ? prevStreak + 1 : 0;
      const learned = streak >= FLASH_LEARN_STREAK || box >= FLASH_MAX_BOX;
      const dueAt = new Date(Date.now() + FLASH_INTERVAL_DAYS[box] * 86_400_000).toISOString();

      const row = {
        morpheme_id: input.morphemeId,
        box,
        consecutive_correct: streak,
        times_seen: (existing?.times_seen ?? 0) + 1,
        times_correct: (existing?.times_correct ?? 0) + (input.knew ? 1 : 0),
        learned,
        due_at: dueAt,
        last_seen_at: new Date().toISOString(),
      };

      if (existing) {
        await ctx.supabase.from('morpheme_review_state').update(row).eq('id', existing.id);
      } else {
        const { error } = await ctx.supabase.from('morpheme_review_state').insert(row);
        if (error) console.error('❌ [vocabulary.reviewFlashcard] insert failed:', error);
      }

      return { learned, box };
    }),

  /**
   * Morpheme-learning progress: how many roots/prefixes/suffixes are learned,
   * seen-but-not-yet-learned, and untouched — overall and per meaning-family.
   */
  morphemeProgress: protectedProcedure.query(async ({ ctx }) => {
    const rows = await loadMorphemes(ctx.supabase);
    const { data: stateData, error } = await ctx.supabase
      .from('morpheme_review_state')
      .select('morpheme_id, learned, times_seen');
    if (error) {
      console.error('❌ [vocabulary.morphemeProgress] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load morpheme progress' });
    }

    const stateById = new Map((stateData ?? []).map((s) => [s.morpheme_id as string, s]));
    type Bucket = { total: number; learned: number; seen: number };
    const byGroup = new Map<string, Bucket>();
    let total = 0;
    let learned = 0;
    let seen = 0;

    for (const m of rows) {
      const st = stateById.get(m.id);
      const isLearned = (st?.learned as boolean | undefined) === true;
      const isSeen = !!st && ((st.times_seen as number | undefined) ?? 0) > 0;
      total += 1;
      if (isLearned) learned += 1;
      if (isSeen) seen += 1;

      const g = byGroup.get(m.meaning_group) ?? { total: 0, learned: 0, seen: 0 };
      g.total += 1;
      if (isLearned) g.learned += 1;
      if (isSeen) g.seen += 1;
      byGroup.set(m.meaning_group, g);
    }

    const groups = Array.from(byGroup.entries())
      .map(([key, b]) => ({ key, ...b }))
      .sort((a, b) => a.learned / a.total - b.learned / b.total);

    return { total, learned, seen, byGroup: groups };
  }),

  /**
   * SAT-word coverage across every practice exercise: how many of the shared
   * (default) words the user has actually practised at least once — a distinct
   * word_id in vocabulary_attempts covers the Decode Trainer, sentence completion
   * and free response — plus how many have reached "learned" in the review system.
   */
  wordCoverage: protectedProcedure.query(async ({ ctx }) => {
    const [totalRes, attemptsRes, reviewRes] = await Promise.all([
      ctx.supabase
        .from('vocabulary_words')
        .select('id', { count: 'exact', head: true })
        .eq('is_default', true),
      ctx.supabase
        .from('vocabulary_attempts')
        .select('word_id, vocabulary_words!inner ( is_default )'),
      ctx.supabase.from('vocab_review_state').select('word_id, learned'),
    ]);

    if (attemptsRes.error || reviewRes.error) {
      console.error('❌ [vocabulary.wordCoverage] Query failed:', attemptsRes.error ?? reviewRes.error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load word coverage' });
    }

    const total = totalRes.count ?? 0;

    const practicedIds = new Set<string>();
    for (const row of attemptsRes.data ?? []) {
      const w = row.vocabulary_words as unknown as { is_default: boolean } | null;
      if (w?.is_default && row.word_id) practicedIds.add(row.word_id as string);
    }

    const learned = (reviewRes.data ?? []).filter((r) => r.learned === true).length;

    return { total, practiced: practicedIds.size, learned };
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
        .in('exercise_type', ['free_response', 'sentence_completion']),
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
      bump(byExercise, row.exercise_type as string, row.was_correct as boolean | null);
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
