-- Storage for question figures (charts, graphs, tables cropped out of a PDF).
--
-- `visual_data` already exists but holds a *text transcription* of a figure.
-- That is useful for search and for the AI verification path, but it can't be
-- rendered — a bar chart described in prose is not a bar chart. `visual_url`
-- holds the actual cropped PNG.

alter table public.questions
  add column if not exists visual_url text;

comment on column public.questions.visual_url is
  'Public URL of the figure cropped from the source PDF. Null when the question has no figure.';

-- Public bucket, deliberately:
--
-- These render in <img> tags on the test screen, and the built-in banks are
-- shared by every user. Signed URLs would expire mid-sitting, defeat browser
-- caching, and need a round trip per image. The content is cropped from
-- publicly published College Board practice material and contains nothing
-- user-specific — there is no secret to protect, only a chart to display.
insert into storage.buckets (id, name, public)
values ('question-figures', 'question-figures', true)
on conflict (id) do update set public = true;

-- Writes stay restricted. Anyone may read a figure; only the owner of the
-- upload path may create or replace one. Paths are `<user-uuid>/<bank>/<id>.png`,
-- with built-in figures written by the seed script under the service role.
drop policy if exists "question_figures_insert_own" on storage.objects;
create policy "question_figures_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'question-figures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question_figures_update_own" on storage.objects;
create policy "question_figures_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'question-figures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "question_figures_delete_own" on storage.objects;
create policy "question_figures_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'question-figures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
