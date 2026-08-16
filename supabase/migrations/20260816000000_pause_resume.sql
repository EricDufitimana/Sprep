-- Pause & resume a sitting.
--
-- Leaving a test now freezes its countdown instead of letting the clock drain in
-- the background, so a sitting can be picked up later with its remaining time
-- intact.
--
--   * `status` gains a 'paused' value. status is free text (default
--     'in_progress'), so there's no enum/constraint to alter.
--   * `resumed_at` anchors the current running segment. Each time the sitting is
--     paused, the active seconds since `resumed_at` are folded into the existing
--     `time_used_seconds` accumulator; on resume, `resumed_at` is stamped to now.
--     Remaining time is therefore (timer_seconds − time_used_seconds), counted
--     down from `resumed_at`.
--   * Legacy in-progress attempts have `resumed_at` null and `time_used_seconds`
--     null, which the app treats as `resumed_at = started_at` and 0 used —
--     identical to the previous behaviour.
alter table public.test_attempts
  add column if not exists resumed_at timestamptz;
