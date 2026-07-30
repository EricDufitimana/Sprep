-- Vocabulary learning module: roots/prefixes/suffixes + AI-graded exercises.
--
-- This expands the personal-word trainer into a curated learning module. Two
-- ideas sit side by side:
--
--   • morphemes — a *shared reference corpus* (roots, prefixes, suffixes),
--     owned by no user. It mirrors the is_default pattern already used for
--     built-in question banks: seeded by the service role, readable by everyone,
--     never written by the publishable-key client.
--
--   • vocabulary_words — the existing *personal* table, extended to also hold a
--     seeded shared word list (is_default = true, user_id null) alongside each
--     user's own words. Same coexistence trick as default question_banks.
--
-- Attempts are always per-user (auth.uid()), so progress stays private even
-- though the study material is shared.

-- ── enums ───────────────────────────────────────────────────────────────────

create type public.morpheme_type as enum ('root', 'prefix', 'suffix');

-- Charge on a morpheme is optional: suffixes carry no positive/negative tone,
-- so their charge is SQL NULL rather than a "null" enum member. Reuses the same
-- three tones as word_charge but as its own type so the nullable column reads
-- cleanly.
create type public.morpheme_charge as enum ('positive', 'negative', 'neutral');

-- Which grader produced an attempt. Multiple choice and decode are auto-graded
-- (no AI); free_response is graded by the grade_vocab_answer edge function.
create type public.vocab_exercise_type as enum ('multiple_choice', 'decode', 'free_response');

-- ── morphemes: the shared roots / prefixes / suffixes ───────────────────────

create table public.morphemes (
  id             uuid primary key default gen_random_uuid(),
  type           public.morpheme_type not null,
  text           text not null,
  meaning        text not null,
  -- Groups morphemes into meaning-families ("negation", "speaking") so the
  -- Learn UI can present them the way the reference doc does — not alphabetically.
  meaning_group  text not null,
  -- Null for suffixes and other tone-neutral pieces; see morpheme_charge above.
  charge         public.morpheme_charge,
  -- jsonb array of example words that contain this piece.
  example_words  jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  -- The same piece text can legitimately recur (e.g. "vener" as both a prefix
  -- and a root group); disambiguate on (type, text).
  unique (type, text)
);

create index idx_morphemes_group on public.morphemes (meaning_group);
create index idx_morphemes_type on public.morphemes (type);

-- Shared reference data: every authenticated user reads the whole corpus.
-- Writes happen only through the service role (seed script), which bypasses RLS.
alter table public.morphemes enable row level security;
create policy "morphemes_select_all" on public.morphemes
  for select using (true);

-- ── morpheme_attempts: per-user practice log for MC and decode ──────────────

create table public.morpheme_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  morpheme_id    uuid not null references public.morphemes (id) on delete cascade,
  exercise_type  public.vocab_exercise_type not null,
  was_correct    boolean not null,
  -- Only meaningful for AI-graded exercises; MC/decode leave it null.
  ai_score       int check (ai_score is null or (ai_score >= 0 and ai_score <= 100)),
  created_at     timestamptz not null default now()
);

create index idx_morpheme_attempts_user on public.morpheme_attempts (user_id, created_at desc);
create index idx_morpheme_attempts_morpheme on public.morpheme_attempts (morpheme_id);

alter table public.morpheme_attempts enable row level security;
create policy "morpheme_attempts_rw_own" on public.morpheme_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── extend vocabulary_words ─────────────────────────────────────────────────

-- Link a word to the root it demonstrates. Kept alongside the existing free-text
-- `root` column so the legacy personal trainer is untouched.
alter table public.vocabulary_words
  add column if not exists root_id uuid references public.morphemes (id) on delete set null;

-- Seeded shared words have user_id null and is_default true, exactly like
-- built-in question banks. Personal words keep user_id = auth.uid().
alter table public.vocabulary_words
  add column if not exists is_default boolean not null default false;
alter table public.vocabulary_words
  alter column user_id drop not null;

-- False friends: the SAT sense differs from the everyday sense.
alter table public.vocabulary_words
  add column if not exists false_friend boolean not null default false;
alter table public.vocabulary_words
  add column if not exists sat_meaning text;
alter table public.vocabulary_words
  add column if not exists everyday_meaning text;

-- Won't-decode words: skip the chop method, lean on a memory hook.
alter table public.vocabulary_words
  add column if not exists no_decode boolean not null default false;
alter table public.vocabulary_words
  add column if not exists memory_hook text;

create index if not exists idx_vocabulary_words_default on public.vocabulary_words (is_default);
create index if not exists idx_vocabulary_words_root on public.vocabulary_words (root_id);

-- Everyone can read the seeded shared words; the existing _rw_own policy still
-- governs each user's personal words. Postgres ORs permissive policies, so a
-- user sees their own words plus the shared corpus.
drop policy if exists "vocabulary_words_select_default" on public.vocabulary_words;
create policy "vocabulary_words_select_default" on public.vocabulary_words
  for select using (is_default);

-- ── extend vocabulary_attempts for AI-graded free response ──────────────────

-- The existing charge-guess columns stay for legacy rows. Free-response rows add
-- the exercise type, the raw answer, and the AI grade written back from the
-- grade_vocab_answer edge function.
alter table public.vocabulary_attempts
  add column if not exists exercise_type public.vocab_exercise_type;
alter table public.vocabulary_attempts
  add column if not exists user_answer text;
alter table public.vocabulary_attempts
  add column if not exists ai_score int check (ai_score is null or (ai_score >= 0 and ai_score <= 100));
alter table public.vocabulary_attempts
  add column if not exists ai_verdict text;
alter table public.vocabulary_attempts
  add column if not exists ai_feedback text;
alter table public.vocabulary_attempts
  add column if not exists was_correct boolean;
