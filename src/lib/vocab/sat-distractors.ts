/**
 * The SAT "Words in Context" trap engine.
 *
 * On the SAT, a sentence-completion / words-in-context question is never a
 * vocabulary quiz with three random wrong words. Every wrong answer is a
 * *designed trap*, aimed at a specific way students misread the sentence. If you
 * study released items, the same four traps recur, and this module reproduces
 * them so the practice item is hard in the way a real item is hard — not merely
 * because the words are obscure.
 *
 * The traps we model (see TrapRole):
 *
 *   1. reversal   — a word whose meaning is the OPPOSITE of the answer. It fits
 *                   perfectly if you miss the sentence's logical pivot ("although",
 *                   "but", "despite", "rather than"). The single most common SAT
 *                   trap: it punishes reading the tone but not the direction.
 *
 *   2. same_tone  — a word with the SAME charge (positive/negative) as the answer
 *                   but the wrong meaning. It defeats the "this blank needs a good
 *                   word" shortcut: the good-word instinct is right, so tone alone
 *                   can't separate it from the answer.
 *
 *   3. associate  — a word thematically tied to a noun in the sentence. It "sounds
 *                   like it belongs" with the topic, so it survives a shallow,
 *                   vibe-based read that never checks the precise defined meaning.
 *
 *   4. hard_word  — an unfamiliar, impressive-looking word unrelated in meaning.
 *                   It baits the "if I don't recognize it, it's probably the
 *                   answer" instinct that test-takers fall back on under pressure.
 *
 * A real SAT item also guarantees every option is the same part of speech and
 * grammatically valid in the blank, so grammar can never eliminate a choice — we
 * enforce that too (options are drawn from the same part_of_speech and shown in
 * base dictionary form). And it never plants two defensible answers: a distractor
 * that is a near-synonym of the key would create a second right answer, so we
 * guard against it with a definition-overlap check.
 *
 * Everything here is a pure function of the word rows — no AI, no network — so the
 * same classification runs at generation time (to *pick* traps) and at grade time
 * (to *explain* them), and the two always agree.
 */

export type Tone = 'positive' | 'negative' | 'neutral';

export type TrapRole = 'answer' | 'reversal' | 'same_tone' | 'associate' | 'hard_word' | 'filler';

export interface WordRow {
  word: string;
  definition: string;
  /** Explicit curated charge when we have it; most rows don't. */
  charge: Tone | null;
  /** Same root_id ⇒ likely related meaning; used to avoid accidental synonyms. */
  rootId: string | null;
}

// ── tone inference ───────────────────────────────────────────────────────────
//
// Only ~5% of the corpus carries a curated `charge`, but the tone/reversal traps
// need a tone for every word. So where charge is absent we infer a coarse tone
// from the *definition* text with a cue lexicon. It's approximate — good enough
// to build believable tone traps, and we always defer to an explicit charge.

const POSITIVE_CUES = [
  'admir', 'praise', 'honor', 'honour', 'respect', 'revere', 'virtu', 'excellent',
  'good', 'kind', 'gener', 'benef', 'benev', 'favor', 'favour', 'love', 'joy',
  'happy', 'happi', 'delight', 'pleas', 'calm', 'peace', 'wise', 'wisdom', 'skill',
  'success', 'prosper', 'brave', 'courage', 'noble', 'gracious', 'charm', 'cheer',
  'hope', 'gift', 'talent', 'clever', 'bright', 'pure', 'gentle', 'warm', 'friend',
  'sincere', 'humble', 'elegan', 'beaut', 'harmon', 'thrive', 'worthy', 'merit',
  'brilliant', 'remarkab', 'splend', 'agreeab', 'amiab', 'fortunate', 'abundan',
  'rich', 'lively', 'vigor', 'earnest', 'devot', 'loyal', 'faith', 'generous',
];

const NEGATIVE_CUES = [
  'corrupt', 'cruel', 'harm', 'hate', 'evil', 'wicked', 'hostil', 'anger', 'angry',
  'fear', 'grief', 'sorrow', 'pain', 'suffer', 'destroy', 'ruin', 'decay', 'diseas',
  'poison', 'greed', 'arrogan', 'deceit', 'deceiv', 'dishonest', 'violent', 'danger',
  'threat', 'coward', 'foolish', 'stupid', 'ignoran', 'lazy', 'dull', 'harsh',
  'bitter', 'gloom', 'despair', 'misery', 'miserab', 'dread', 'disgust', 'contempt',
  'scorn', 'mock', 'insult', 'offend', 'spite', 'malic', 'envy', 'jealous', 'selfish',
  'stubborn', 'rude', 'vulgar', 'filth', 'dirty', 'ugly', 'terribl', 'horrib', 'awful',
  'worthless', 'useless', 'fraud', 'betray', 'tyran', 'oppress', 'brutal', 'savage',
  'vile', 'sinist', 'wither', 'barren', 'povert', 'condemn', 'punish', 'blame',
  'criticiz', 'criticis', 'complain', 'quarrel', 'conflict', 'chaos', 'confus',
  'excess', 'gaudy', 'crude', 'gloom', 'grim', 'harm', 'weak', 'timid', 'petty',
];

/** Cheap negation: "not honest", "free from corruption", "lacking warmth". */
const NEGATORS = ['not ', 'without ', 'lack', 'absence', 'free from', 'devoid', 'no longer', 'un'];

export function inferTone(definition: string): Tone {
  const text = ` ${definition.toLowerCase()} `;
  let pos = 0;
  let neg = 0;
  for (const cue of POSITIVE_CUES) if (text.includes(cue)) pos += 1;
  for (const cue of NEGATIVE_CUES) if (text.includes(cue)) neg += 1;

  // A negation term flips the reading ("free from vice" is positive, not negative).
  // The "-less" suffix negates too (fearless, harmless), so we count it as well.
  const negated = NEGATORS.some((n) => text.includes(` ${n}`)) || /\b[a-z]{3,}less\b/.test(text);
  if (negated) [pos, neg] = [neg, pos];

  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

/** An explicit charge always wins; otherwise fall back to the inferred tone. */
export function toneOf(row: WordRow): Tone {
  return row.charge ?? inferTone(row.definition);
}

// ── tokenization / association ───────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or',
  'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'as', 'that', 'this',
  'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'his', 'her', 'their',
  'who', 'whom', 'which', 'what', 'when', 'where', 'while', 'from', 'into', 'out',
  'up', 'down', 'not', 'no', 'so', 'than', 'then', 'too', 'very', 'can', 'will',
  'would', 'could', 'should', 'may', 'might', 'one', 'someone', 'something', 'often',
  'usually', 'especially', 'esp', 'etc', 'such', 'more', 'most', 'less', 'least',
  'having', 'having', 'make', 'made', 'given', 'used', 'able', 'way', 'person',
  'people', 'thing', 'things', 'characterized', 'relating', 'related', 'marked',
]);

/** Content tokens (≥3 chars, de-stopped, stemmed to a prefix) for overlap math. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z']+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    // Crude stemming so "corrupted" and "corrupt" collide.
    out.add(raw.replace(/(ing|ed|es|s|ly|ness|ment|tion|ion)$/, '').slice(0, 6));
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach((t) => {
    if (b.has(t)) n += 1;
  });
  return n;
}

/** Jaccard on definition tokens — the near-synonym / "two right answers" guard. */
function definitionSimilarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = overlap(ta, tb);
  return inter / (ta.size + tb.size - inter);
}

// ── pivot detection ──────────────────────────────────────────────────────────
//
// The reversal trap is only *fair* — and only maximally tempting — when the
// sentence actually turns on a contrast the reader might miss.

const PIVOT_WORDS = [
  'although', 'though', 'even though', 'despite', 'in spite of', 'however', 'but ',
  'yet ', 'whereas', 'while ', 'rather than', 'instead of', 'unlike', 'nevertheless',
  'nonetheless', 'on the contrary', 'contrary to', 'far from', 'no longer', 'once ',
  'until ', 'not only', 'ironically', 'paradox', 'surpris',
];

export function hasPivot(sentence: string): boolean {
  const s = ` ${sentence.toLowerCase()} `;
  return PIVOT_WORDS.some((p) => s.includes(p));
}

// ── blanking the sentence ────────────────────────────────────────────────────

export const BLANK_TOKEN = '[[blank]]';

/**
 * Replace the first occurrence of the target word (in any inflection) with the
 * blank sentinel. Returns null when the sentence doesn't actually contain the
 * word — the generator then picks a different word.
 *
 * We match on a stem so "debauched" is found for "debauch", but require the
 * matched token to be close in length to the word so a short stem doesn't blank
 * an unrelated longer word.
 */
export function blankSentence(sentence: string, word: string): string | null {
  const w = word.toLowerCase();
  const stem = w.slice(0, Math.max(4, w.length - 2));
  const re = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z']*\\b`, 'i');
  const m = re.exec(sentence);
  if (!m) return null;
  const matched = m[0].toLowerCase();
  // Reject a stem that latched onto a much longer, unrelated word.
  if (matched.length > w.length + 4) return null;
  return sentence.slice(0, m.index) + BLANK_TOKEN + sentence.slice(m.index + m[0].length);
}

// ── classification (used at grade time to explain each option) ───────────────

const TONE_WORD: Record<Tone, string> = { positive: 'positive', negative: 'negative', neutral: 'neutral' };

/**
 * Explain why a given option is what it is, relative to the answer and sentence.
 * Deterministic, so the reveal always matches how the option was chosen.
 */
export function classifyTrap(
  option: WordRow,
  answer: WordRow,
  sentence: string,
): { role: TrapRole; why: string } {
  if (option.word.toLowerCase() === answer.word.toLowerCase()) {
    return { role: 'answer', why: 'Matches the meaning the sentence sets up.' };
  }

  const answerTone = toneOf(answer);
  const optionTone = toneOf(option);
  const context = contentTokens(sentence);
  const assoc = overlap(contentTokens(option.definition), context);

  // We name a tone confidently only when both words carry a *curated* charge;
  // where the tone is inferred from the definition it's approximate, so the
  // explanation stays general rather than asserting a label that might be off.
  const confident = option.charge !== null && answer.charge !== null;

  // Opposite tone ⇒ the reversal trap (only meaningful when tones are non-neutral).
  if (answerTone !== 'neutral' && optionTone !== 'neutral' && optionTone !== answerTone) {
    return {
      role: 'reversal',
      why: confident
        ? `Opposite in tone (${TONE_WORD[optionTone]}) — it fits only if you miss the sentence's turn and read the meaning backward.`
        : 'Roughly the opposite meaning — it fits only if you misread the sentence’s direction and flip its logic.',
    };
  }

  // Same non-neutral tone ⇒ the tone trap.
  if (answerTone !== 'neutral' && optionTone === answerTone) {
    return {
      role: 'same_tone',
      why: confident
        ? `Same ${TONE_WORD[optionTone]} tone as the answer, but the wrong meaning — tone alone won't separate it.`
        : 'Close to the answer in feel but wrong in meaning — you can’t rule it out by tone alone.',
    };
  }

  // Strong topical pull ⇒ the association trap.
  if (assoc >= 1) {
    return {
      role: 'associate',
      why: 'Sounds tied to the topic of the sentence, but it doesn’t carry the meaning the blank needs.',
    };
  }

  // Otherwise it reads as the "impressive but unrelated" word.
  return {
    role: 'hard_word',
    why: 'An unfamiliar-looking word with an unrelated meaning — tempting when you’re unsure, but it doesn’t fit.',
  };
}

// ── distractor construction (used at generation time) ────────────────────────

export interface BuiltItem {
  /** The four option words, shuffled, base dictionary form. */
  options: string[];
  /** How hard the trap set turned out — surfaced as a difficulty cue. */
  difficulty: 'gentle' | 'tricky' | 'brutal';
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Scored {
  row: WordRow;
  tone: Tone;
  assoc: number;
  simToAnswer: number;
}

/**
 * Choose three distractors for `answer`, each filling a distinct SAT trap role,
 * given a same-part-of-speech candidate `pool` and the (un-blanked) sentence.
 *
 * Returns null when the pool is too thin to build a legitimate item; the caller
 * then tries another word.
 */
export function buildDistractors(answer: WordRow, pool: WordRow[], sentence: string): BuiltItem | null {
  const answerTone = toneOf(answer);
  const context = contentTokens(sentence);
  const answerWord = answer.word.toLowerCase();

  // Score the pool, dropping anything that would be a second defensible answer:
  // a near-synonym by definition, a same-root relative, or the word itself.
  const scored: Scored[] = [];
  const seenWords = new Set([answerWord]);
  for (const row of pool) {
    const lw = row.word.toLowerCase();
    if (seenWords.has(lw)) continue;
    seenWords.add(lw);
    if (answer.rootId && row.rootId && answer.rootId === row.rootId) continue;
    const sim = definitionSimilarity(answer.definition, row.definition);
    if (sim >= 0.34) continue; // too close in meaning ⇒ risks two right answers
    scored.push({
      row,
      tone: toneOf(row),
      assoc: overlap(contentTokens(row.definition), context),
      simToAnswer: sim,
    });
  }

  if (scored.length < 3) return null;

  const chosen: WordRow[] = [];
  const used = new Set<string>();
  const take = (s: Scored | undefined): boolean => {
    if (!s) return false;
    const lw = s.row.word.toLowerCase();
    if (used.has(lw)) return false;
    used.add(lw);
    chosen.push(s.row);
    return true;
  };
  const remaining = () => scored.filter((s) => !used.has(s.row.word.toLowerCase()));

  const pivot = hasPivot(sentence);

  // 1. Reversal — opposite tone, most on-topic. Prioritized when the sentence
  //    has a pivot the student could miss.
  if (answerTone !== 'neutral') {
    const opposite = answerTone === 'positive' ? 'negative' : 'positive';
    const cands = remaining()
      .filter((s) => s.tone === opposite)
      .sort((a, b) => b.assoc - a.assoc);
    take(cands[0]);
  }

  // 2. Same-tone — matches the answer's charge, most on-topic.
  if (answerTone !== 'neutral') {
    const cands = remaining()
      .filter((s) => s.tone === answerTone)
      .sort((a, b) => b.assoc - a.assoc);
    take(cands[0]);
  }

  // 3. Associate — strongest topical pull regardless of tone.
  {
    const cands = remaining()
      .filter((s) => s.assoc >= 1)
      .sort((a, b) => b.assoc - a.assoc);
    take(cands[0]);
  }

  // 4. Hard word — longest/most obscure-looking, to bait the "must be right" guess.
  if (chosen.length < 3) {
    const cands = remaining().sort((a, b) => b.row.word.length - a.row.word.length);
    take(cands[0]);
  }

  // Backfill anything still missing with the least answer-like remaining words.
  for (const s of remaining().sort((a, b) => a.simToAnswer - b.simToAnswer)) {
    if (chosen.length >= 3) break;
    take(s);
  }

  if (chosen.length < 3) return null;

  // Difficulty reflects how complete the trap set is: a reversal on a pivot
  // sentence plus a same-tone trap is a genuinely brutal item.
  const roles = chosen.map((r) => classifyTrap(r, answer, sentence).role);
  const hasReversal = roles.includes('reversal');
  const hasSameTone = roles.includes('same_tone');
  let difficulty: BuiltItem['difficulty'] = 'gentle';
  if (hasReversal && (pivot || hasSameTone)) difficulty = 'brutal';
  else if (hasReversal || hasSameTone) difficulty = 'tricky';

  return {
    options: shuffle([answer.word, ...chosen.slice(0, 3).map((r) => r.word)]),
    difficulty,
  };
}
