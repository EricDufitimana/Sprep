import type { BadgeTone } from '@/components/ui/badge';
import type { ProgressTone } from '@/components/ui/progress-bar';

/** Friendly names for the meaning-families, mirroring the reference doc. */
export const GROUP_LABEL: Record<string, string> = {
  negation: 'Negation',
  direction: 'Direction & position',
  time_order: 'Time & order',
  quantity_sameness: 'Quantity, number & sameness',
  size_degree: 'Size & degree',
  judgment_quality: 'Judgment & quality',
  relation_self: 'Self, together & false',
  speaking_writing_silence: 'Speaking, writing & silence',
  belief_trust_judgment: 'Mind, senses & belief',
  people_self_life: 'People & society',
  society_law: 'Society, law & order',
  body_health: 'Body, life & health',
  feeling_love_calm: 'Feeling, love & calm',
  movement_change_breaking: 'Movement, change & breaking',
  action_making: 'Making, doing & shape',
  nature_world: 'Nature, space & place',
  time_measure: 'Time, number & measure',
  qualities_states: 'Qualities & states',
  suffix_partofspeech: 'Suffixes (part of speech)',
};

/** Display order: prefixes' families first, then roots', then suffixes. */
export const GROUP_ORDER = [
  'negation',
  'direction',
  'time_order',
  'quantity_sameness',
  'size_degree',
  'judgment_quality',
  'relation_self',
  'speaking_writing_silence',
  'belief_trust_judgment',
  'people_self_life',
  'society_law',
  'body_health',
  'feeling_love_calm',
  'movement_change_breaking',
  'action_making',
  'nature_world',
  'time_measure',
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
