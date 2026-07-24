-- Only submitted sittings count toward performance.
--
-- Answers are autosaved while a test is in progress so a sitting survives a
-- refresh, but an abandoned attempt is not a result and must not affect the
-- record. The old view counted every saved answer, and since `is_correct` is
-- written only at submit time, an abandoned attempt's answers counted toward
-- `total_answered` while never counting toward `total_correct` — silently
-- dragging accuracy down for tests the student never even finished.
--
-- Joining `test_attempts` and filtering on `status = 'submitted'` fixes both:
-- unfinished work is invisible, and finished work is scored on the snapshot
-- written at submit.

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
  join test_attempts t on t.id = a.attempt_id
  where a.selected_answer is not null
    and t.status = 'submitted'
  group by a.user_id, q.domain, q.skill;

comment on view public.skill_performance is
  'Per-skill accuracy from submitted sittings only. In-progress attempts are excluded so abandoned tests never affect the record.';
