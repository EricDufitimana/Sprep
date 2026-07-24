-- ============================================================================
-- SPrep — storage setup
-- Paste into the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- The private bucket that holds uploaded question papers.
-- `public = false` means no anonymous reads; the extraction edge function
-- signs short-lived URLs with the service role when it needs to read a page.
insert into storage.buckets (id, name, public)
values ('question-papers', 'question-papers', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security on the objects in that bucket.
--
-- Ownership is encoded in the path: `<user-uuid>/<timestamp>/<filename>.pdf`.
-- `storage.foldername(name)` splits the path into segments, so `[1]` is the
-- leading user id. Comparing it to auth.uid() means a user can only ever
-- touch files under their own prefix.
-- ---------------------------------------------------------------------------

drop policy if exists "question_papers_insert_own" on storage.objects;
create policy "question_papers_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question_papers_select_own" on storage.objects;
create policy "question_papers_select_own"
  on storage.objects for select
  using (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question_papers_update_own" on storage.objects;
create policy "question_papers_update_own"
  on storage.objects for update
  using (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question_papers_delete_own" on storage.objects;
create policy "question_papers_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'question-papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
select id, name, public from storage.buckets where id = 'question-papers';

select policyname, cmd
from pg_policies
where tablename = 'objects' and policyname like 'question_papers%'
order by policyname;
