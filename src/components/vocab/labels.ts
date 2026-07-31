import type { BadgeTone } from '@/components/ui/badge';
import type { ProgressTone } from '@/components/ui/progress-bar';

/** Friendly names for the meaning-families, mirroring the reference doc. */
export const GROUP_LABEL: Record<string, string> = {
  negation: 'Negation',
  direction: 'Direction',
  quantity_sameness: 'Quantity & sameness',
  judgment_quality: 'Judgment & quality',
  speaking_writing_silence: 'Speaking, writing & silence',
  belief_trust_judgment: 'Belief, trust & judgment',
  people_self_life: 'People, self & life',
  feeling_love_calm: 'Feeling, love & calm',
  movement_change_breaking: 'Movement, change & breaking',
  qualities_states: 'Qualities & states',
  suffix_partofspeech: 'Suffixes (part of speech)',
};

/** Display order: prefixes' families, then roots', then suffixes. */
export const GROUP_ORDER = [
  'negation',
  'direction',
  'quantity_sameness',
  'judgment_quality',
  'speaking_writing_silence',
  'belief_trust_judgment',
  'people_self_life',
  'feeling_love_calm',
  'movement_change_breaking',
  'qualities_states',
  'suffix_partofspeech',
];

export const EXERCISE_LABEL: Record<string, string> = {
  multiple_choice: 'Multiple choice',
  decode: 'Decode the word',
  free_response: 'Free response',
  sentence_completion: 'Sentence completion',
};

export const CHARGE_LABEL: Record<string, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

/** Charge → the app's pill colors, same mapping the ChargePicker uses. */
export const CHARGE_TONE: Record<string, BadgeTone> = {
  positive: 'green',
  negative: 'miss',
  neutral: 'blue',
};

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const groupLabel = (key: string) => GROUP_LABEL[key] ?? titleCase(key);

export function accuracyTone(pct: number): ProgressTone {
  if (pct >= 80) return 'green';
  if (pct >= 50) return 'amber';
  return 'miss';
}
