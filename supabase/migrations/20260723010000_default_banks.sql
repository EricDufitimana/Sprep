-- Built-in question banks.
--
-- The two SAT banks ship with the app rather than belonging to a user, so
-- `user_id` becomes nullable and a new permissive SELECT policy exposes
-- anything flagged `is_default` to every signed-in user. Postgres ORs
-- permissive policies together, so the existing owner-only policies are
-- untouched — a user still sees their own banks plus the built-ins.

alter table public.question_banks
  add column if not exists is_default boolean not null default false;

alter table public.questions
  add column if not exists is_default boolean not null default false;

-- System-owned rows have no owner.
alter table public.question_banks alter column user_id drop not null;
alter table public.questions      alter column user_id drop not null;

comment on column public.question_banks.is_default is
  'Built-in bank shipped with the app; readable by every signed-in user.';

drop policy if exists "question_banks_select_default" on public.question_banks;
create policy "question_banks_select_default"
  on public.question_banks for select
  to authenticated
  using (is_default);

drop policy if exists "questions_select_default" on public.questions;
create policy "questions_select_default"
  on public.questions for select
  to authenticated
  using (is_default);

-- Attempts against a built-in bank are still owned by the person sitting it,
-- so nothing changes on test_attempts / answers.

create index if not exists idx_question_banks_default
  on public.question_banks (is_default) where is_default;
