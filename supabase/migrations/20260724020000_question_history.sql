-- Shared "question history": one row per question a user has completed, in any
-- mode. This is the single source of truth both the timed-test builder and the
-- new /dashboard/question-bank browse page consult for "exclude questions I've
-- already done".
--
-- Before this table, "already done" was derived from `answers` joined to
-- submitted `test_attempts` — test-mode only, per bank. That derivation can't
-- record browse completions (browse writes no `answers` rows), so this table
-- unifies both flows. The bank-test and module selectors, and the browse page,
-- all now read from here.

create table if not exists public.question_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  source       text not null check (source in ('test', 'browse')),
  attempt_id   uuid references public.test_attempts(id) on delete set null, -- set when source = 'test'
  was_correct  boolean, -- null when source = 'browse' and no self-report given
  completed_at timestamptz not null default now()
);

create index if not exists idx_question_history_user on public.question_history(user_id, question_id);

alter table public.question_history enable row level security;
drop policy if exists "own question history" on public.question_history;
create policy "own question history" on public.question_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Backfill from existing submitted sittings so nobody's "already done" state
-- resets when the exclusion switches to this table. One row per (attempt,
-- question) that was actually answered.
insert into public.question_history (user_id, question_id, source, attempt_id, was_correct, completed_at)
select a.user_id,
       a.question_id,
       'test',
       a.attempt_id,
       a.is_correct,
       coalesce(a.answered_at, ta.submitted_at, now())
from public.answers a
join public.test_attempts ta on ta.id = a.attempt_id
where ta.status = 'submitted'
  and a.selected_answer is not null;
