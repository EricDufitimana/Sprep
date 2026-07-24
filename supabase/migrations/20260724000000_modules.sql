-- Composed practice modules: full SAT sections built from several banks.
--
-- A module is a saved *recipe* — which banks to draw from, in what balance —
-- not a fixed question list. Each sitting generates a fresh selection that
-- excludes questions already answered, so doing a module again never repeats
-- questions. It shows up in Practice like a bank, but its questions live in
-- their original banks; only the recipe is stored here.

create table public.modules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null,
  -- 'dsat' balances to the official R&W domain mix; 'custom' uses explicit
  -- per-domain counts. 'single' is a saved multi-sitting wrapper around one bank.
  format           text not null default 'dsat',
  total_questions  int not null,
  -- The banks this module draws from.
  source_bank_ids  uuid[] not null,
  -- Snapshot of the intended per-domain plan, for display: {"information_and_ideas": 7, ...}.
  plan             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index idx_modules_user on public.modules (user_id, created_at desc);

alter table public.modules enable row level security;

create policy "modules_select_own" on public.modules for select using (auth.uid() = user_id);
create policy "modules_insert_own" on public.modules for insert with check (auth.uid() = user_id);
create policy "modules_update_own" on public.modules for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "modules_delete_own" on public.modules for delete using (auth.uid() = user_id);

-- ── Per-attempt frozen question set ─────────────────────────────────────────
--
-- Previously an attempt re-derived its questions from bank_id on every load.
-- That can't work for a module (its questions are a specific balanced draw from
-- several banks) and was already subtly wrong for excludeSeen sittings, which
-- could load a different set on refresh. Freezing the exact ordered set per
-- attempt fixes both: the sitting is reproducible and can span banks.

create table public.attempt_questions (
  attempt_id   uuid not null references public.test_attempts (id) on delete cascade,
  question_id  uuid not null references public.questions (id) on delete cascade,
  position     int not null,
  primary key (attempt_id, question_id)
);

create index idx_attempt_questions_attempt on public.attempt_questions (attempt_id, position);

alter table public.attempt_questions enable row level security;

-- The attempt owns these rows; gate on the parent attempt's owner.
create policy "attempt_questions_select_own"
  on public.attempt_questions for select
  using (exists (
    select 1 from public.test_attempts t
    where t.id = attempt_id and t.user_id = auth.uid()
  ));

create policy "attempt_questions_insert_own"
  on public.attempt_questions for insert
  with check (exists (
    select 1 from public.test_attempts t
    where t.id = attempt_id and t.user_id = auth.uid()
  ));

create policy "attempt_questions_delete_own"
  on public.attempt_questions for delete
  using (exists (
    select 1 from public.test_attempts t
    where t.id = attempt_id and t.user_id = auth.uid()
  ));

-- ── Let an attempt belong to a module instead of a single bank ──────────────

alter table public.test_attempts
  add column if not exists module_id uuid references public.modules (id) on delete set null;

-- Bank attempts still set bank_id; module attempts set module_id and leave
-- bank_id null. Exactly one must be present.
alter table public.test_attempts alter column bank_id drop not null;

alter table public.test_attempts
  drop constraint if exists test_attempts_source_check;
alter table public.test_attempts
  add constraint test_attempts_source_check
  check (num_nonnulls(bank_id, module_id) = 1);

create index if not exists idx_attempts_module on public.test_attempts (module_id);
