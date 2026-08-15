-- Ad-hoc timed sittings: a "build an exam module" flow (from the Question Bank)
-- draws a fresh, SAT-balanced set straight from the verified pool and sits it
-- timed, without saving a bank or a reusable module first. Such an attempt
-- belongs to neither a bank nor a module, so:
--
--   1. The source check is relaxed from "exactly one of bank_id/module_id" to
--      "at most one" — an ad-hoc attempt has both null.
--   2. A `title` column carries the human-readable name (e.g. "Hard · Reading
--      & Writing exam module"), since there's no bank/module row to name it.
--      Bank and module attempts leave it null and keep naming via their relation.

alter table public.test_attempts
  add column if not exists title text;

alter table public.test_attempts
  drop constraint if exists test_attempts_source_check;
alter table public.test_attempts
  add constraint test_attempts_source_check
  check (num_nonnulls(bank_id, module_id) <= 1);
