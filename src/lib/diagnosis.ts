/**
 * The fixed set of "why I missed it" reasons a learner picks from on the results
 * screen. Selectable (not free text) so the choices aggregate cleanly on the
 * Progress page — "40% of your misses are misreads, not content" is only
 * possible if everyone taps the same small vocabulary.
 *
 * The `key` is what we persist in `answers.self_diagnosis`; the `label` is shown
 * in the UI. Keep keys stable — changing one orphans historical rows.
 */
export const DIAGNOSIS_REASONS = [
  { key: 'misread', label: 'Misread the question or passage', hint: 'Knew it, but misread what was asked' },
  { key: 'concept', label: "Didn't know the concept", hint: 'A genuine knowledge gap to study' },
  { key: 'trap', label: 'Fell for a trap answer', hint: 'A tempting distractor got me' },
  { key: 'rushed', label: 'Rushed or ran out of time', hint: 'Pacing, not knowledge' },
  { key: 'careless', label: 'Careless slip', hint: 'Knew it, picked the wrong letter' },
  { key: 'guessed', label: 'Just guessed', hint: 'No real basis for the pick' },
] as const;

export type DiagnosisKey = (typeof DIAGNOSIS_REASONS)[number]['key'];

export const DIAGNOSIS_KEYS = DIAGNOSIS_REASONS.map((r) => r.key) as [DiagnosisKey, ...DiagnosisKey[]];

const LABELS: Record<string, string> = Object.fromEntries(
  DIAGNOSIS_REASONS.map((r) => [r.key, r.label]),
);

export function diagnosisLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return LABELS[key] ?? null;
}
