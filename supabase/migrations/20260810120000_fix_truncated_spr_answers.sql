-- Fix truncated grid-in (SPR) answers.
--
-- A batch of manually-added math grid-in questions (external_ids ending "-DC")
-- shipped with their answer stored as the *integer truncation* of the real
-- value: "1" instead of "1.5", "25" instead of "25.4", and so on. The decimal
-- part was lost at data-entry time, so every student who typed the true answer
-- was marked incorrect even though the scoring code was working correctly.
--
-- The real answer is the one stated in plain text in each question's own
-- explanation ("The correct answer is 1.5."). This migration rewrites the 12
-- affected rows to that value plus its fraction form, matching how the SAT
-- lists grid-in answers. Keyed by external_id and idempotent, so it is safe to
-- re-run and safe on environments seeded from the (now-patched) source JSON.
--
-- Detection + repair logic lives in scripts/lib/spr-answer-reconcile.mjs and is
-- enforced going forward by the ingest guard and scripts/audit-spr-answers.mjs.

update public.questions as q
   set correct_answer   = fix.correct_answer,
       accepted_answers = fix.accepted_answers
  from (values
    ('070608-DC', '4.44', '["4.44","111/25"]'::jsonb),
    ('070609-DC', '22.4', '["22.4","112/5"]'::jsonb),
    ('070610-DC', '1.2', '["1.2","6/5"]'::jsonb),
    ('070611-DC', '2.6', '["2.6","13/5"]'::jsonb),
    ('070612-DC', '1.5', '["1.5","3/2"]'::jsonb),
    ('070613-DC', '1.25', '["1.25","5/4"]'::jsonb),
    ('070614-DC', '1.5', '["1.5","3/2"]'::jsonb),
    ('070617-DC', '2.5', '["2.5","5/2"]'::jsonb),
    ('070624-DC', '25.4', '["25.4","127/5"]'::jsonb),
    ('070625-DC', '1.3', '["1.3","13/10"]'::jsonb),
    ('070627-DC', '2.6', '["2.6","13/5"]'::jsonb),
    ('070630-DC', '4.5', '["4.5","9/2"]'::jsonb)
  ) as fix(external_id, correct_answer, accepted_answers)
 where q.external_id = fix.external_id
   and q.answer_format = 'spr';
