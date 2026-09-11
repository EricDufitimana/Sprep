-- Separate the user's pasted practice-set questions from the College Board
-- question bank so the two are never mixed in the Question Bank browse flow.
--
-- Practice sets were uploaded through the app (createFromPdf / extraction) as
-- their own small banks and, having no release_batch, silently landed in the
-- "original" cohort alongside the big Bluebook ingests. `category` puts them on
-- their own axis instead:
--
--   NULL              = the College Board Question Bank (the bulk ingests).
--   'digital_sat_1600' = "The Digital SAT 1600" — questions the user pasted in.
--
-- This is independent of release_batch (Original/New): a question is in exactly
-- one category, and within the Question Bank the release cohort still applies.
alter table public.questions
  add column if not exists category text;

comment on column public.questions.category is
  'Which Question Bank category the question belongs to; NULL = the College Board bank, ''digital_sat_1600'' = the user''s pasted "Digital SAT 1600" sets. Drives the Question Bank category switch.';

-- The browse flow scans the verified pool by section + category, so index them
-- together the same way release_batch is indexed.
create index if not exists idx_questions_category
  on public.questions (section, category);

-- Backfill: every question whose bank is NOT one of the four College Board
-- ingest banks is a pasted practice-set question. Defining it by exclusion (any
-- non-CB-ingest bank) rather than by the current upload-path prefix keeps the
-- classification correct regardless of who uploaded a set.
update public.questions q
set category = 'digital_sat_1600'
from public.question_banks b
where q.bank_id = b.id
  and q.category is null
  and coalesce(b.source_file, '') <> all (array[
    'sat-question-bank-1',
    'sat-question-bank-2',
    'json:sat-question-bank-full',
    'json:sat-math-full'
  ]);
