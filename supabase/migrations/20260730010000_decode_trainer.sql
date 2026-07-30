-- Words-in-Context Decode Trainer: per-user spaced-repetition state and the
-- extra attempt fields the trainer logs.
--
-- The word corpus is shared (is_default vocabulary_words), but each user's
-- progress through it — which box a word is in, when it's next due, whether it's
-- "learned" — is private. That per-user state can't live on the shared word row,
-- so it gets its own table, RLS-scoped to the owner like every other user table.

-- ── vocab_review_state: one Leitner card per (user, word) ───────────────────
--
-- Leitner rule (implemented in the vocabularyTrainer router):
--   correct → box = min(box+1, 5); miss → box = 1.
--   due_at = last_seen + interval[box], with intervals in days:
--     box1 = 0 (same session), box2 = 1, box3 = 3, box4 = 7, box5 = 16.
--   "learned" once consecutive_correct >= 3 (or box reaches 5); learned cards
--   drop out of a session unless "Exclude learned" is turned off.
--
-- `source` records how the word entered this user's pool: 'seed' (picked from
-- the default corpus), 'trainer_miss' (missed here), 'question_bank' (a word
-- that appeared in a missed Words-in-Context question), or 'manual'.

create table public.vocab_review_state (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word_id             uuid not null references public.vocabulary_words (id) on delete cascade,
  box                 int not null default 1 check (box between 1 and 5),
  consecutive_correct int not null default 0,
  times_seen          int not null default 0,
  times_correct       int not null default 0,
  learned             boolean not null default false,
  source              text not null default 'seed',
  due_at              timestamptz not null default now(),
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (user_id, word_id)
);

create index idx_review_state_due on public.vocab_review_state (user_id, due_at);
create index idx_review_state_word on public.vocab_review_state (word_id);

alter table public.vocab_review_state enable row level security;
create policy "vocab_review_state_rw_own" on public.vocab_review_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── trainer fields on vocabulary_attempts ───────────────────────────────────
--
-- The trainer logs into the existing attempts table so vocab practice feeds the
-- same progress system as everything else. It reuses guessed_charge /
-- charge_correct (from the charge-first commit step) and adds two columns:
--   used_hint    — did the user open the "Break it down" hint before answering?
--                  (the decode-vs-guess stat turns on this)
--   trainer_mode — 'definition' | 'sentence' | 'cold'
alter table public.vocabulary_attempts
  add column if not exists used_hint boolean;
alter table public.vocabulary_attempts
  add column if not exists trainer_mode text;
