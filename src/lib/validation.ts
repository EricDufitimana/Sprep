import { z } from 'zod';

/**
 * Shared Zod schemas. Same style as CRC's `lib/validation.ts` — message-bearing
 * schemas defined once here and reused by routers, so validation copy stays
 * consistent between the API and any form that mirrors it.
 */

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Matches the `question_domain` enum in Postgres. */
export const questionDomainSchema = z.enum([
  'information_and_ideas',
  'craft_and_structure',
  'expression_of_ideas',
  'standard_english_conventions',
]);

/** Matches the `question_difficulty` enum in Postgres. */
export const questionDifficultySchema = z.enum(['easy', 'medium', 'hard']);

/** Matches the `extraction_status` enum in Postgres. */
export const extractionStatusSchema = z.enum(['verified', 'needs_review', 'skipped']);

/** Matches the `word_charge` enum in Postgres. */
export const wordChargeSchema = z.enum(['positive', 'negative', 'neutral']);

export const answerLetterSchema = z.enum(ANSWER_LETTERS, {
  errorMap: () => ({ message: 'Answer must be A, B, C, or D' }),
});

/** `questions.options` is jsonb shaped `[{letter, text}]`. */
export const questionOptionSchema = z.object({
  letter: answerLetterSchema,
  text: z.string().min(1, { message: 'Option text is required' }),
});

export const questionOptionsSchema = z
  .array(questionOptionSchema)
  .length(4, { message: 'A question must have exactly 4 options' })
  .refine(
    (opts) => new Set(opts.map((o) => o.letter)).size === 4,
    { message: 'Options must use each of A, B, C, D exactly once' },
  );

export const questionBankSchema = z.object({
  name: z
    .string()
    .min(1, { message: 'Name is required' })
    .max(120, { message: 'Name must be at most 120 characters' }),
  description: z
    .string()
    .max(500, { message: 'Description must be at most 500 characters' })
    .optional()
    .or(z.literal('')),
  source_file: z.string().optional().or(z.literal('')),
});

/**
 * A question as produced by the extraction edge function, before insert.
 * `correct_answer` must be one of the option letters — enforced below.
 */
export const extractedQuestionSchema = z
  .object({
    external_id: z.string().optional(),
    position: z.number().int().min(1),
    domain: questionDomainSchema.nullable().optional(),
    skill: z.string().nullable().optional(),
    difficulty: questionDifficultySchema.nullable().optional(),
    passage: z.string().nullable().optional(),
    question_text: z.string().min(1, { message: 'Question text is required' }),
    options: questionOptionsSchema,
    correct_answer: answerLetterSchema,
    explanation: z.string().nullable().optional(),
    has_visual: z.boolean().default(false),
    visual_data: z.string().nullable().optional(),
    extraction_status: extractionStatusSchema.default('verified'),
  })
  .refine(
    (q) => q.options.some((o) => o.letter === q.correct_answer),
    { message: 'correct_answer must match one of the option letters', path: ['correct_answer'] },
  );

/**
 * The vocabulary trainer decodes words from context, so a sentence is
 * mandatory here even though the column is nullable for legacy rows.
 */
export const vocabularyWordSchema = z.object({
  word: z.string().min(1, { message: 'Word is required' }),
  sentence: z
    .string()
    .min(1, { message: 'A sentence is required — the word must appear in context' })
    .refine((s) => s.trim().split(/\s+/).length >= 3, {
      message: 'Sentence must be a real sentence, not a fragment',
    }),
  definition: z.string().min(1, { message: 'Definition is required' }),
  root: z.string().optional().or(z.literal('')),
  charge: wordChargeSchema,
  part_of_speech: z.string().optional().or(z.literal('')),
});

export const profileUpdateSchema = z.object({
  display_name: z.string().max(80, { message: 'Display name must be at most 80 characters' }).optional(),
  username: z
    .string()
    .min(3, { message: 'Username must be at least 3 characters' })
    .max(30, { message: 'Username must be at most 30 characters' })
    .regex(/^[a-z0-9_]+$/, { message: 'Username may use lowercase letters, numbers, and underscores only' })
    .optional(),
  avatar_id: z.string().max(80).optional(),
  avatar_url: z.string().url({ message: 'Avatar URL must be valid' }).optional().or(z.literal('')),
  target_score: z
    .number()
    .int()
    .min(400, { message: 'Target score must be at least 400' })
    .max(1600, { message: 'Target score must be at most 1600' })
    .optional(),
  test_date: z.string().date('Test date must be a valid date').optional(),
});
