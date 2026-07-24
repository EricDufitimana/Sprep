-- Phase: timed/untimed sittings + PDF source storage.
--
-- 1. `was_timed` records how a sitting was run. It is a permanent property of
--    the attempt, not a derived one: `timer_seconds IS NULL` would be
--    ambiguous, since a timed attempt could in principle store a null timer.
alter table public.test_attempts
  add column if not exists was_timed boolean not null default true;

comment on column public.test_attempts.was_timed is
  'True when the sitting ran with a countdown. Untimed sittings still record time_used_seconds.';

-- 2. Private bucket for uploaded question papers and answer keys. The
--    extraction edge function signs URLs out of it with the service role;
--    users never read from it directly.
insert into storage.buckets (id, name, public)
values ('question-papers', 'question-papers', false)
on conflict (id) do nothing;

-- Owner-only access, matching the ownership model on every other table here.
-- Paths are namespaced by user id: `<uid>/<bank>/<file>.pdf`.
create policy "question_papers_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "question_papers_select_own"
  on storage.objects for select
  using (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "question_papers_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
