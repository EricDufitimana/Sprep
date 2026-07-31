-- Morpheme flashcards: per-user learning state for the roots / prefixes / suffixes.
--
-- The morpheme corpus is shared (public.morphemes, owned by no user), but how far
-- each user has learned a given piece is private — so, exactly like the word-level
-- vocab_review_state, it gets its own owner-scoped table. A flashcard "knew it /
-- still learning" review runs the same Leitner scheme the Decode Trainer uses:
--   knew → box = min(box+1, 5); miss → box = 1.
--   "learned" once consecutive_correct >= 3 (or box reaches 5).
-- due_at drives which cards resurface first in a study session.

create table public.morpheme_review_state (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  morpheme_id         uuid not null references public.morphemes (id) on delete cascade,
  box                 int not null default 1 check (box between 1 and 5),
  consecutive_correct int not null default 0,
  times_seen          int not null default 0,
  times_correct       int not null default 0,
  learned             boolean not null default false,
  due_at              timestamptz not null default now(),
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (user_id, morpheme_id)
);

create index idx_morpheme_review_due on public.morpheme_review_state (user_id, due_at);
create index idx_morpheme_review_morpheme on public.morpheme_review_state (morpheme_id);

alter table public.morpheme_review_state enable row level security;
create policy "morpheme_review_state_rw_own" on public.morpheme_review_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
