import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTRPCRouter, protectedProcedure } from '../init';

/**
 * The Words-in-Context Decode Trainer.
 *
 * Everything the user practises comes from real seed data — the SAT words and
 * their human-written example sentences, plus the morpheme table for the decode
 * hint. Nothing here generates a word, a sentence, or a distractor from a model;
 * distractors are real meanings/words sampled from the pool, preferring the same
 * charge or root so wrong answers aren't obviously off. The only AI in the whole
 * vocabulary feature is the separate free-response grader.
 *
 * Spaced repetition is a plain Leitner scheme (see LEITNER below). Per-user
 * review state lives in vocab_review_state; every answer is also logged to
 * vocabulary_attempts so the trainer feeds the same progress system as the rest
 * of SPrep.
 */

type Mode = 'definition' | 'sentence' | 'cold';
type Charge = 'positive' | 'negative' | 'neutral';

const modeSchema = z.enum(['definition', 'sentence', 'cold']);
const chargeSchema = z.enum(['positive', 'negative', 'neutral']);

/** Leitner: correct → up one box (longer wait); miss → back to box 1. */
const MAX_BOX = 5;
const LEARN_STREAK = 3;
const INTERVAL_DAYS: Record<number, number> = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };

interface WordRow {
  id: string;
  word: string;
  definition: string | null;
  sentence: string | null;
  charge: Charge | null;
  part_of_speech: string | null;
  root_id: string | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * Choose 3 distractors for `target` from `pool`, preferring — in order — words
 * of the same charge, then the same root, then anything, so wrong options are
 * plausible rather than obviously off. `valueOf` maps a word to the string that
 * competes as an option (its own text, or its definition).
 */
function chooseDistractors(target: WordRow, pool: WordRow[], valueOf: (w: WordRow) => string | null): string[] {
  const correct = valueOf(target);
  const usable = pool.filter((w) => w.id !== target.id && valueOf(w) && valueOf(w) !== correct);

  const sameCharge = target.charge ? usable.filter((w) => w.charge === target.charge) : [];
  const sameRoot = target.root_id ? usable.filter((w) => w.root_id === target.root_id) : [];

  const out: string[] = [];
  const seen = new Set<string>([correct ?? '']);
  for (const bucket of [shuffle(sameRoot), shuffle(sameCharge), shuffle(usable)]) {
    for (const w of bucket) {
      if (out.length >= 3) break;
      const v = valueOf(w)!;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    if (out.length >= 3) break;
  }
  return out;
}

async function loadDefaultWords(supabase: SupabaseClient): Promise<WordRow[]> {
  const { data, error } = await supabase
    .from('vocabulary_words')
    .select('id, word, definition, sentence, charge, part_of_speech, root_id')
    .eq('is_default', true);

  if (error) {
    console.error('❌ [trainer.loadDefaultWords] Query failed:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load the word pool' });
  }
  return (data ?? []) as unknown as WordRow[];
}

interface ReviewRow {
  word_id: string;
  box: number;
  due_at: string;
  learned: boolean;
}

async function loadReviewState(supabase: SupabaseClient): Promise<Map<string, ReviewRow>> {
  const { data, error } = await supabase
    .from('vocab_review_state')
    .select('word_id, box, due_at, learned');
  if (error) {
    console.error('❌ [trainer.loadReviewState] Query failed:', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load your progress' });
  }
  return new Map((data ?? []).map((r) => [r.word_id as string, r as unknown as ReviewRow]));
}

export const vocabularyTrainerRouter = createTRPCRouter({
  /**
   * The next word to practise, with its 4 options — the correct one unmarked.
   *
   * Selection: due review cards first (a missed word resurfaces the moment it
   * comes due), then words never seen. Cold mode deliberately serves an unseen,
   * longer (rarer-proxy) word in sentence form. "Exclude learned" drops words a
   * user has 3-in-a-row on unless they turn it off.
   */
  nextItem: protectedProcedure
    .input(z.object({ mode: modeSchema, excludeLearned: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      const [words, review] = await Promise.all([
        loadDefaultWords(ctx.supabase),
        loadReviewState(ctx.supabase),
      ]);

      const needsSentence = input.mode === 'sentence' || input.mode === 'cold';
      const eligible = words.filter((w) => w.definition && (!needsSentence || w.sentence));
      if (eligible.length < 4) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Not enough words seeded yet — run the vocab seeds.' });
      }

      const now = Date.now();
      const isLearned = (w: WordRow) => review.get(w.id)?.learned === true;
      const isUnseen = (w: WordRow) => !review.has(w.id);
      const isDue = (w: WordRow) => {
        const r = review.get(w.id);
        return r ? new Date(r.due_at).getTime() <= now : false;
      };

      let target: WordRow;
      if (input.mode === 'cold') {
        // A word the user has never seen, biased toward longer (rarer) words.
        const unseen = eligible.filter(isUnseen);
        const fromPool = unseen.length > 0 ? unseen : eligible;
        const hardest = [...fromPool].sort((a, b) => b.word.length - a.word.length).slice(0, 60);
        target = pick(hardest);
      } else {
        const pool = input.excludeLearned ? eligible.filter((w) => !isLearned(w)) : eligible;
        const base = pool.length > 0 ? pool : eligible;
        const due = base.filter(isDue);
        const unseen = base.filter(isUnseen);
        // Due cards (including resurfaced misses) first, then new words, then
        // whatever's left so a session never dead-ends.
        target = due.length > 0 ? pick(due) : unseen.length > 0 ? pick(unseen) : pick(base);
      }

      const chargeFirst = input.mode !== 'definition' && target.charge != null;

      if (input.mode === 'definition') {
        // Prompt is the definition; the 4 options are words.
        const options = shuffle([target.word, ...chooseDistractors(target, eligible, (w) => w.word)]);
        return {
          mode: input.mode,
          wordId: target.id,
          word: target.word,
          partOfSpeech: target.part_of_speech,
          promptDefinition: target.definition,
          sentence: null as string | null,
          options,
          chargeFirst: false,
        };
      }

      // Sentence / cold: prompt is the real sentence; the 4 options are meanings.
      const options = shuffle([target.definition!, ...chooseDistractors(target, eligible, (w) => w.definition)]);
      return {
        mode: input.mode,
        wordId: target.id,
        word: target.word,
        partOfSpeech: target.part_of_speech,
        promptDefinition: null as string | null,
        sentence: target.sentence,
        options,
        chargeFirst,
      };
    }),

  /**
   * Grade one answer, advance the Leitner card, and log the attempt (with the
   * charge guess, hint use, and mode) so it feeds the progress system.
   */
  gradeItem: protectedProcedure
    .input(
      z.object({
        wordId: z.string().uuid(),
        mode: modeSchema,
        selected: z.string().min(1),
        usedHint: z.boolean().default(false),
        chargeGuess: chargeSchema.nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: word, error } = await ctx.supabase
        .from('vocabulary_words')
        .select('id, word, definition, charge, root_id, morphemes ( meaning_group )')
        .eq('id', input.wordId)
        .single();

      if (error || !word || !word.definition) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Word not found' });
      }

      const correctAnswer = input.mode === 'definition' ? word.word : word.definition;
      const correct = input.selected.trim() === (correctAnswer as string).trim();

      const chargeCorrect =
        input.chargeGuess != null && word.charge != null ? input.chargeGuess === word.charge : null;

      // ── Leitner update ──
      const { data: existing } = await ctx.supabase
        .from('vocab_review_state')
        .select('id, box, consecutive_correct, times_seen, times_correct, source')
        .eq('word_id', input.wordId)
        .maybeSingle();

      const prevBox = existing?.box ?? 1;
      const prevStreak = existing?.consecutive_correct ?? 0;
      const box = correct ? Math.min(prevBox + 1, MAX_BOX) : 1;
      const streak = correct ? prevStreak + 1 : 0;
      const learned = streak >= LEARN_STREAK || box >= MAX_BOX;
      const dueAt = new Date(Date.now() + INTERVAL_DAYS[box] * 86_400_000).toISOString();

      const stateRow = {
        word_id: input.wordId,
        box,
        consecutive_correct: streak,
        times_seen: (existing?.times_seen ?? 0) + 1,
        times_correct: (existing?.times_correct ?? 0) + (correct ? 1 : 0),
        learned,
        source: existing?.source ?? 'seed',
        due_at: dueAt,
        last_seen_at: new Date().toISOString(),
      };

      if (existing) {
        await ctx.supabase.from('vocab_review_state').update(stateRow).eq('id', existing.id);
      } else {
        const { error: insErr } = await ctx.supabase.from('vocab_review_state').insert(stateRow);
        if (insErr) console.error('❌ [trainer.gradeItem] review insert failed:', insErr);
      }

      // ── Attempt log (feeds progress) ──
      const { error: logErr } = await ctx.supabase.from('vocabulary_attempts').insert({
        word_id: input.wordId,
        exercise_type: 'multiple_choice',
        trainer_mode: input.mode,
        user_answer: input.selected,
        was_correct: correct,
        guessed_charge: input.chargeGuess,
        charge_correct: chargeCorrect,
        used_hint: input.usedHint,
      });
      if (logErr) console.error('❌ [trainer.gradeItem] attempt log failed:', logErr);

      const meaningGroup =
        (word.morphemes as unknown as { meaning_group: string } | null)?.meaning_group ?? null;

      // Reveal only after the answer is committed.
      return {
        correct,
        correctAnswer: correctAnswer as string,
        word: word.word,
        definition: word.definition as string,
        charge: word.charge as Charge | null,
        chargeCorrect,
        meaningGroup,
        learned,
      };
    }),

  /**
   * The "Break it down" hint: which known morphemes appear in this word, and
   * what they mean — the decode path, NOT the answer.
   */
  breakdown: protectedProcedure
    .input(z.object({ wordId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: word, error } = await ctx.supabase
        .from('vocabulary_words')
        .select('word')
        .eq('id', input.wordId)
        .single();
      if (error || !word) throw new TRPCError({ code: 'NOT_FOUND', message: 'Word not found' });

      const { data: morphemes, error: mErr } = await ctx.supabase
        .from('morphemes')
        .select('text, meaning, type, charge');
      if (mErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load morphemes' });

      const lower = (word.word as string).toLowerCase();
      const pieces: { text: string; meaning: string; type: string; charge: Charge | null; at: number }[] = [];
      const seen = new Set<string>();

      for (const m of morphemes ?? []) {
        // A morpheme's text can be a slash list ("tacit / tic") or hyphenated
        // ("dis-"); match any bare variant that actually appears in the word.
        const variants = (m.text as string)
          .split('/')
          .map((v) => v.trim().toLowerCase().replace(/^-+|-+$/g, ''))
          .filter((v) => v.length >= 3);
        for (const v of variants) {
          const at = lower.indexOf(v);
          if (at !== -1 && !seen.has(m.text as string)) {
            seen.add(m.text as string);
            pieces.push({ text: m.text as string, meaning: m.meaning as string, type: m.type as string, charge: m.charge as Charge | null, at });
          }
        }
      }

      pieces.sort((a, b) => a.at - b.at);
      return { word: word.word as string, pieces: pieces.map(({ at: _at, ...p }) => p) };
    }),

  /**
   * Grow the pool from real misses elsewhere in SPrep: scan the user's recent
   * missed "Words in Context" questions and enqueue any seeded vocab word that
   * literally appears in them. Never fabricates a target — only real seeded
   * words that show up in a question the user got wrong. Runs at session start.
   */
  syncWeakWords: protectedProcedure.mutation(async ({ ctx }) => {
    const { data: misses, error } = await ctx.supabase
      .from('answers')
      .select('questions!inner ( question_text, passage, options, skill )')
      .eq('is_correct', false)
      .ilike('questions.skill', '%context%')
      .limit(100);

    if (error) {
      console.error('❌ [trainer.syncWeakWords] Query failed:', error);
      return { added: 0 };
    }
    if (!misses || misses.length === 0) return { added: 0 };

    // Only match reasonably distinctive words (length ≥ 5) to avoid enqueuing
    // common connective words that happen to be in the corpus.
    const words = await loadDefaultWords(ctx.supabase);
    const byWord = new Map<string, string>();
    for (const w of words) if (w.word.length >= 5) byWord.set(w.word.toLowerCase(), w.id);

    const existing = await loadReviewState(ctx.supabase);
    const toAdd = new Set<string>();

    for (const row of misses) {
      const q = row.questions as unknown as { question_text: string | null; passage: string | null; options: unknown };
      const optionText = Array.isArray(q.options)
        ? (q.options as { text?: string }[]).map((o) => o?.text ?? '').join(' ')
        : '';
      const haystack = `${q.question_text ?? ''} ${q.passage ?? ''} ${optionText}`.toLowerCase();
      for (const token of haystack.split(/[^a-z]+/)) {
        const id = byWord.get(token);
        if (id && !existing.has(id)) toAdd.add(id);
        if (toAdd.size >= 50) break; // bound the enqueue
      }
      if (toAdd.size >= 50) break;
    }

    if (toAdd.size === 0) return { added: 0 };

    const rows = Array.from(toAdd).map((word_id) => ({
      word_id,
      source: 'question_bank',
      box: 1,
      due_at: new Date().toISOString(),
    }));
    const { error: insErr } = await ctx.supabase
      .from('vocab_review_state')
      .upsert(rows, { onConflict: 'user_id,word_id', ignoreDuplicates: true });
    if (insErr) {
      console.error('❌ [trainer.syncWeakWords] Insert failed:', insErr);
      return { added: 0 };
    }
    return { added: rows.length };
  }),

  /**
   * Persistent trainer stats for the Progress view: accuracy by word-charge,
   * how reliably the user reads charge, decode-vs-guess (hint) accuracy, and the
   * weakest root-family — so the numbers say what to study.
   */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('vocabulary_attempts')
      .select('was_correct, guessed_charge, charge_correct, used_hint, vocabulary_words!inner ( charge, morphemes ( meaning_group ) )')
      .not('trainer_mode', 'is', null);

    if (error) {
      console.error('❌ [trainer.stats] Query failed:', error);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not load trainer stats' });
    }

    type Bucket = { attempts: number; correct: number };
    const add = (m: Map<string, Bucket>, k: string, ok: boolean | null) => {
      if (ok === null) return;
      const b = m.get(k) ?? { attempts: 0, correct: 0 };
      b.attempts += 1;
      if (ok) b.correct += 1;
      m.set(k, b);
    };
    const pct = (b: Bucket) => (b.attempts === 0 ? 0 : Math.round((b.correct / b.attempts) * 1000) / 10);

    const byCharge = new Map<string, Bucket>();
    const byRootFamily = new Map<string, Bucket>();
    const withHint: Bucket = { attempts: 0, correct: 0 };
    const withoutHint: Bucket = { attempts: 0, correct: 0 };
    const chargeRead: Bucket = { attempts: 0, correct: 0 };

    const bump = (b: Bucket, ok: boolean | null) => {
      if (ok === null) return;
      b.attempts += 1;
      if (ok) b.correct += 1;
    };

    for (const row of data ?? []) {
      const w = row.vocabulary_words as unknown as { charge: string | null; morphemes: { meaning_group: string } | null } | null;
      const ok = row.was_correct as boolean | null;
      if (w?.charge) add(byCharge, w.charge, ok);
      if (w?.morphemes?.meaning_group) add(byRootFamily, w.morphemes.meaning_group, ok);
      if (row.used_hint === true) bump(withHint, ok);
      else if (row.used_hint === false) bump(withoutHint, ok);
      if (row.charge_correct === true || row.charge_correct === false) bump(chargeRead, row.charge_correct);
    }

    const rootFamilies = Array.from(byRootFamily.entries())
      .map(([key, b]) => ({ key, attempts: b.attempts, accuracyPercent: pct(b) }))
      .sort((a, b) => a.accuracyPercent - b.accuracyPercent);

    return {
      byCharge: Array.from(byCharge.entries()).map(([key, b]) => ({ key, attempts: b.attempts, accuracyPercent: pct(b) })),
      chargeReadAccuracy: chargeRead.attempts > 0 ? pct(chargeRead) : null,
      decodeVsGuess: {
        withHint: { attempts: withHint.attempts, accuracyPercent: pct(withHint) },
        withoutHint: { attempts: withoutHint.attempts, accuracyPercent: pct(withoutHint) },
      },
      weakestRootFamily: rootFamilies[0] ?? null,
      rootFamilies,
    };
  }),
});
