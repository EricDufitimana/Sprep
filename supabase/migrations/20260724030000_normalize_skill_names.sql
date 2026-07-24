-- Normalize skill names so the /dashboard/question-bank drill-down shows one
-- row per skill, not near-duplicates.
--
-- The PDF-seeded built-in banks label a few skills slightly differently from
-- the JSON-ingested bank (College Board's PDF spells out "and"; the JSON uses
-- "&", and tags Command of Evidence textual/quantitative). This aligns every
-- bank to the JSON bank's canonical names.

update public.questions set skill = 'Central Ideas & Details'
  where skill = 'Central Ideas and Details';

update public.questions set skill = 'Text Structure & Purpose'
  where skill = 'Text Structure and Purpose';

-- Command of Evidence: the quantitative variant is the one carrying a figure
-- (graph/table); everything else is textual. Same rule the JSON ingest used.
update public.questions set skill = 'Command of Evidence (Quantitative)'
  where skill = 'Command of Evidence' and has_visual = true;

update public.questions set skill = 'Command of Evidence (Textual)'
  where skill = 'Command of Evidence' and has_visual = false;
