-- Per-question time tracking, so pace can be computed later across every mode.
--
-- Two surfaces record "how long did this one question take":
--   • `answers.time_spent_ms`         — timed tests and modules (the /test/[id]
--                                        runner accumulates dwell time per
--                                        question and flushes it on autosave).
--   • `question_history.time_spent_ms` — the untimed question-bank taker, which
--                                        times each question individually and
--                                        writes it when the answer is checked.
--
-- Milliseconds (not seconds) because individual questions are short and pace
-- math benefits from sub-second resolution. Nullable: historical rows and any
-- write that couldn't measure time simply carry NULL.

alter table public.answers
  add column if not exists time_spent_ms integer;

comment on column public.answers.time_spent_ms is
  'Milliseconds the user actively spent on this question during the sitting. Null when not measured.';

alter table public.question_history
  add column if not exists time_spent_ms integer;

comment on column public.question_history.time_spent_ms is
  'Milliseconds spent on the question when completed (question-bank taker times each one). Null when not measured.';
