-- Add the sentence-completion exercise to the vocab exercise-type enum.
--
-- Sentence completion is a word-level, auto-graded exercise (no AI): the user
-- reads a real example sentence with the word blanked and picks it from four
-- SAT-style options. Attempts are logged to vocabulary_attempts alongside
-- free_response, so the existing per-word / per-meaning-family progress rollups
-- pick them up with no schema change beyond this enum value.

alter type public.vocab_exercise_type add value if not exists 'sentence_completion';
