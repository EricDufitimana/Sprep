-- Tag questions by the College Board release they first appeared in, so the
-- Question Bank can show the newly-released batch separately from the original
-- pool instead of silently mixing them.
--
-- NULL  = original pool (everything ingested before batches were tracked).
-- '2026-08' (or any later date key) = a question that first appeared in that
--          Bluebook refresh. The ingest scripts stamp this only on rows they
--          INSERT (a brand-new external_id); existing rows are never reclassified.
alter table public.questions
  add column if not exists release_batch text;

comment on column public.questions.release_batch is
  'Bluebook release key (e.g. 2026-08) the question first appeared in; NULL = original pool. Drives the Question Bank Original/New switch.';

-- The Question Bank filters the whole verified pool by section + batch, so index
-- the columns the drill-down counts and set-builder scan together.
create index if not exists idx_questions_release_batch
  on public.questions (section, release_batch);
