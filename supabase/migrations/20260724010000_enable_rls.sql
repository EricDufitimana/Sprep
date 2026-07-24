-- Enable row level security on every user-data table.
--
-- These tables were created with RLS disabled, so the publishable-key client
-- the app uses could read and write across users — the ownership checks in the
-- routers were the only guard, and several queries (bank lists, the
-- skill_performance view) relied on RLS that wasn't actually on. The service
-- role (seed script, edge functions) bypasses RLS, so seeding is unaffected.
--
-- Every policy scopes to the owner. Built-in question_banks/questions
-- (user_id null, is_default true) additionally get a public read policy, since
-- they're shared by everyone. Postgres ORs permissive policies, so a user sees
-- their own rows plus the built-ins.

-- ── profiles: the row id IS the user id ─────────────────────────────────────
alter table public.profiles enable row level security;
drop policy if exists "profiles_rw_own" on public.profiles;
create policy "profiles_rw_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ── question_banks ──────────────────────────────────────────────────────────
alter table public.question_banks enable row level security;
drop policy if exists "question_banks_select_own" on public.question_banks;
create policy "question_banks_select_own" on public.question_banks
  for select using (auth.uid() = user_id);
drop policy if exists "question_banks_insert_own" on public.question_banks;
create policy "question_banks_insert_own" on public.question_banks
  for insert with check (auth.uid() = user_id);
drop policy if exists "question_banks_update_own" on public.question_banks;
create policy "question_banks_update_own" on public.question_banks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "question_banks_delete_own" on public.question_banks;
create policy "question_banks_delete_own" on public.question_banks
  for delete using (auth.uid() = user_id);
-- "question_banks_select_default" already exists for built-ins.

-- ── questions ───────────────────────────────────────────────────────────────
alter table public.questions enable row level security;
drop policy if exists "questions_select_own" on public.questions;
create policy "questions_select_own" on public.questions
  for select using (auth.uid() = user_id);
drop policy if exists "questions_insert_own" on public.questions;
create policy "questions_insert_own" on public.questions
  for insert with check (auth.uid() = user_id);
drop policy if exists "questions_update_own" on public.questions;
create policy "questions_update_own" on public.questions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "questions_delete_own" on public.questions;
create policy "questions_delete_own" on public.questions
  for delete using (auth.uid() = user_id);
-- "questions_select_default" already exists for built-ins.

-- ── test_attempts ───────────────────────────────────────────────────────────
alter table public.test_attempts enable row level security;
drop policy if exists "test_attempts_rw_own" on public.test_attempts;
create policy "test_attempts_rw_own" on public.test_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── answers ─────────────────────────────────────────────────────────────────
alter table public.answers enable row level security;
drop policy if exists "answers_rw_own" on public.answers;
create policy "answers_rw_own" on public.answers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── vocabulary_sets / words / attempts ──────────────────────────────────────
alter table public.vocabulary_sets enable row level security;
drop policy if exists "vocabulary_sets_rw_own" on public.vocabulary_sets;
create policy "vocabulary_sets_rw_own" on public.vocabulary_sets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.vocabulary_words enable row level security;
drop policy if exists "vocabulary_words_rw_own" on public.vocabulary_words;
create policy "vocabulary_words_rw_own" on public.vocabulary_words
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.vocabulary_attempts enable row level security;
drop policy if exists "vocabulary_attempts_rw_own" on public.vocabulary_attempts;
create policy "vocabulary_attempts_rw_own" on public.vocabulary_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
