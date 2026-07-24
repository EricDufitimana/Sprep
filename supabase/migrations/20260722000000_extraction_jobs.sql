-- extraction_jobs: progress tracking for the extract_questions_ai edge function.
--
-- Extracting a full practice paper runs far past an HTTP request timeout, so
-- `question-banks-management.createFromExtraction` inserts a row here, invokes
-- the function without awaiting it, and the client polls `getExtractionStatus`.
-- The edge function updates this row as it walks the pages.

create type extraction_job_status as enum ('queued', 'running', 'succeeded', 'failed');

create table public.extraction_jobs (
  id                 uuid primary key default gen_random_uuid(),
  bank_id            uuid not null references public.question_banks (id) on delete cascade,
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status             extraction_job_status not null default 'queued',
  total_pages        int not null default 0,
  pages_done         int not null default 0,
  questions_found    int not null default 0,
  verified_count     int not null default 0,
  needs_review_count int not null default 0,
  skipped_count      int not null default 0,
  error_message      text,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index idx_extraction_jobs_bank on public.extraction_jobs (bank_id);
create index idx_extraction_jobs_user on public.extraction_jobs (user_id, created_at desc);

alter table public.extraction_jobs enable row level security;

-- Same ownership model as every other table here: a user sees only their rows.
-- The edge function writes with the service role, which bypasses these.
create policy "extraction_jobs_select_own"
  on public.extraction_jobs for select
  using (auth.uid() = user_id);

create policy "extraction_jobs_insert_own"
  on public.extraction_jobs for insert
  with check (auth.uid() = user_id);

create policy "extraction_jobs_update_own"
  on public.extraction_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "extraction_jobs_delete_own"
  on public.extraction_jobs for delete
  using (auth.uid() = user_id);
