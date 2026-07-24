-- Merge `question_history` into `answers`: one unified per-question attempt
-- record for every mode (timed test, module, and untimed question bank).
--
-- Why: browse/bank practice couldn't live in `answers` only because
-- `answers.attempt_id` was NOT NULL, so a parallel `question_history` table was
-- added — but submitted test answers then existed in BOTH tables (history was
-- backfilled with `source='test'` mirrors). Making `attempt_id` nullable lets
-- bank practice live in `answers` too, so the second table (and its duplicate
-- writes) is no longer needed. "Already done", pace, and skill analytics all
-- derive from this single table afterwards.

-- 1. A sitting is optional now: NULL attempt_id = untimed bank practice.
alter table public.answers alter column attempt_id drop not null;

-- 2. How the attempt was made, so analytics can split bank vs test vs module
--    without re-deriving it from the attempt each time.
alter table public.answers
  add column if not exists source text
  check (source is null or source in ('test', 'module', 'bank'));

comment on column public.answers.source is
  'How the attempt was made: test | module | bank. Null on legacy/in-progress rows.';

-- Backfill source for existing sitting answers from their attempt.
update public.answers a
set source = case when t.module_id is not null then 'module' else 'test' end
from public.test_attempts t
where t.id = a.attempt_id
  and a.source is null;

-- 3. Move question-bank (browse) history into answers. The old 'test' rows were
--    only mirrors of answers, so they are dropped, not migrated. Historical
--    browse rows never stored the picked letter, so selected_answer is null;
--    was_correct carries their grade.
insert into public.answers
  (user_id, question_id, attempt_id, source, selected_answer, is_correct, time_spent_ms, answered_at)
select h.user_id, h.question_id, null, 'bank', null, h.was_correct, h.time_spent_ms, h.completed_at
from public.question_history h
where h.source = 'browse';

-- 4. Drop the now-redundant table.
drop table if exists public.question_history;

-- 5. Rebuild skill_performance from the single table. `is_correct` is written
--    only at test-submit or a bank check, so `is_correct is not null` already
--    means "graded" — no join to test_attempts is needed to exclude in-progress
--    sittings. The second clause keeps submitted-but-unanswered sitting rows
--    (is_correct=false, no selection) out of the numbers, matching the old view,
--    while always counting bank rows (attempt_id null).
drop view if exists public.skill_performance;
create view public.skill_performance
with (security_invoker = true) as
  select
    a.user_id,
    q.domain,
    q.skill,
    count(*) as total_answered,
    count(*) filter (where a.is_correct) as total_correct,
    round(
      100.0 * count(*) filter (where a.is_correct)::numeric
        / nullif(count(*), 0)::numeric,
      1
    ) as accuracy_percent
  from answers a
  join questions q on q.id = a.question_id
  where a.is_correct is not null
    and (a.attempt_id is null or a.selected_answer is not null)
  group by a.user_id, q.domain, q.skill;

comment on view public.skill_performance is
  'Per-skill accuracy across all modes (tests, modules, question bank) from the unified answers table. Graded rows only (is_correct not null); submitted-but-unanswered sitting rows are excluded.';
