/**
 * Seed the shared vocabulary corpus (morphemes + curated words) from
 * sprep_vocab_seed_data.md.
 *
 * Follows the seed-default-banks.mjs convention: PrismaClient over raw SQL,
 * idempotent, producing `is_default` rows the service role owns (user_id null,
 * readable by every signed-in user via the public-read policies added in
 * 20260730000000_vocabulary_module.sql).
 *
 * Idempotency is by upsert, not delete+insert, so re-running never cascades away
 * a user's practice history:
 *   • morphemes  — ON CONFLICT (type, text) keeps the same id.
 *   • words      — matched on lower(word) among the default rows.
 *
 * Every row below is transcribed verbatim from the source doc — nothing is
 * invented, dropped, or re-tagged. Section decides type: PREFIXES → prefix,
 * ROOTS → root, SUFFIXES → suffix (even where a piece reads root-like, e.g.
 * gress-/flect- listed under prefixes — the doc's grouping is authoritative).
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-vocabulary.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** charge `null` in the doc → SQL NULL (no positive/negative tone). */
const N = null;

// ── PREFIXES ────────────────────────────────────────────────────────────────
const PREFIXES = [
  // negation
  { text: 'in- / im- / il- / ir-', meaning: 'not', charge: 'neutral', group: 'negation', examples: ['inadvertent', 'impartial', 'illogical', 'irreverent'] },
  { text: 'un-', meaning: 'not', charge: 'neutral', group: 'negation', examples: ['unwarranted', 'unprecedented'] },
  { text: 'dis-', meaning: 'not / apart', charge: 'negative', group: 'negation', examples: ['disparage', 'discredit', 'disdain'] },
  { text: 'a- / an-', meaning: 'without', charge: 'neutral', group: 'negation', examples: ['apathetic', 'anomaly', 'amoral'] },
  { text: 'non-', meaning: 'not', charge: 'neutral', group: 'negation', examples: ['nonchalant', 'nondescript'] },
  { text: 'ob-', meaning: 'against', charge: 'negative', group: 'negation', examples: ['obstruct', 'obstacle'] },
  { text: 'contra- / contro-', meaning: 'against', charge: 'neutral', group: 'negation', examples: ['contravene', 'contrary', 'controversy'] },
  // direction
  { text: 'pro-', meaning: 'forward / for', charge: 'neutral', group: 'direction', examples: ['progress', 'proponent'] },
  { text: 're-', meaning: 'back / again', charge: 'neutral', group: 'direction', examples: ['reiterate', 'revive', 'regress'] },
  { text: 'extra-', meaning: 'outside', charge: 'neutral', group: 'direction', examples: ['extraneous', 'extraterrestrial'] },
  { text: 'sub-', meaning: 'under', charge: 'neutral', group: 'direction', examples: ['subordinate', 'subsequent'] },
  { text: 'gress-', meaning: 'step / go', charge: 'neutral', group: 'direction', examples: ['progress', 'regress', 'transgress'] },
  { text: 'flect- / flex-', meaning: 'bend', charge: 'neutral', group: 'direction', examples: ['reflect', 'deflect', 'inflexible'] },
  // quantity_sameness
  { text: 'magn-', meaning: 'large / great', charge: 'neutral', group: 'quantity_sameness', examples: ['magnify', 'magnitude', 'magnanimous'] },
  { text: 'hetero-', meaning: 'different', charge: 'neutral', group: 'quantity_sameness', examples: ['heterogeneous', 'heterodox'] },
  { text: 'homo-', meaning: 'same', charge: 'neutral', group: 'quantity_sameness', examples: ['homogeneous', 'homonym'] },
  { text: 'ultim-', meaning: 'last', charge: 'neutral', group: 'quantity_sameness', examples: ['ultimate', 'penultimate'] },
  // judgment_quality
  { text: 'mal-', meaning: 'bad', charge: 'negative', group: 'judgment_quality', examples: ['malfunction', 'malady', 'malign'] },
  { text: 'grat-', meaning: 'pleasing', charge: 'positive', group: 'judgment_quality', examples: ['gratitude', 'gratuity', 'ingratiate'] },
  { text: 'vener-', meaning: 'respect', charge: 'positive', group: 'judgment_quality', examples: ['venerable', 'veneration'] },
  { text: 'sagac- / sag-', meaning: 'wise', charge: 'positive', group: 'judgment_quality', examples: ['sagacity', 'sage'] },
];

// ── ROOTS ─────────────────────────────────────────────────────────────────
const ROOTS = [
  // speaking_writing_silence
  { text: 'dict', meaning: 'speak', charge: 'neutral', group: 'speaking_writing_silence', examples: ['predict', 'verdict', 'edict'] },
  { text: 'loqu', meaning: 'speak', charge: 'neutral', group: 'speaking_writing_silence', examples: ['loquacious', 'soliloquy', 'eloquent'] },
  { text: 'ling', meaning: 'language', charge: 'neutral', group: 'speaking_writing_silence', examples: ['linguist', 'bilingual'] },
  { text: 'gram', meaning: 'something written', charge: 'neutral', group: 'speaking_writing_silence', examples: ['telegram', 'grammar'] },
  { text: 'graph', meaning: 'to write', charge: 'neutral', group: 'speaking_writing_silence', examples: ['autograph', 'biography'] },
  { text: 'tacit / tic', meaning: 'be silent', charge: 'neutral', group: 'speaking_writing_silence', examples: ['tacit', 'taciturn', 'reticent'] },
  // belief_trust_judgment
  { text: 'cred', meaning: 'believe', charge: 'neutral', group: 'belief_trust_judgment', examples: ['credence', 'incredulous', 'credible'] },
  { text: 'fid', meaning: 'faith', charge: 'positive', group: 'belief_trust_judgment', examples: ['confide', 'infidel', 'fidelity'] },
  { text: 'judi', meaning: 'judge', charge: 'neutral', group: 'belief_trust_judgment', examples: ['judicial', 'adjudicate'] },
  { text: 'vener', meaning: 'respect', charge: 'positive', group: 'belief_trust_judgment', examples: ['venerable', 'veneration'] },
  { text: 'sagac', meaning: 'wise', charge: 'positive', group: 'belief_trust_judgment', examples: ['sagacity', 'sage'] },
  // people_self_life
  { text: 'dem', meaning: 'people', charge: 'neutral', group: 'people_self_life', examples: ['demographic', 'epidemic', 'endemic'] },
  { text: 'ego', meaning: 'I, self', charge: 'neutral', group: 'people_self_life', examples: ['egotistical', 'alter ego'] },
  { text: 'gen', meaning: 'birth / production', charge: 'neutral', group: 'people_self_life', examples: ['generate', 'progeny', 'indigenous'] },
  { text: 'vit', meaning: 'life', charge: 'positive', group: 'people_self_life', examples: ['vital', 'revitalize'] },
  { text: 'sang', meaning: 'blood', charge: 'neutral', group: 'people_self_life', examples: ['sanguine', 'consanguinity'] },
  { text: 'troph', meaning: 'feed / grow', charge: 'neutral', group: 'people_self_life', examples: ['atrophy', 'hypertrophy'] },
  { text: 'somn', meaning: 'sleep', charge: 'neutral', group: 'people_self_life', examples: ['insomnia', 'somnolent'] },
  // feeling_love_calm
  { text: 'ami / am', meaning: 'love', charge: 'positive', group: 'feeling_love_calm', examples: ['amorous', 'enamored', 'amiable'] },
  { text: 'phil', meaning: 'love', charge: 'positive', group: 'feeling_love_calm', examples: ['philosophy', 'bibliophile'] },
  { text: 'esth / aesth', meaning: 'feeling', charge: 'neutral', group: 'feeling_love_calm', examples: ['aesthetic', 'anesthetic'] },
  { text: 'plac', meaning: 'calm', charge: 'neutral', group: 'feeling_love_calm', examples: ['implacable', 'placebo', 'placid'] },
  // movement_change_breaking
  { text: 'mut', meaning: 'change', charge: 'neutral', group: 'movement_change_breaking', examples: ['mutation', 'immutable', 'commute'] },
  { text: 'fug', meaning: 'run away', charge: 'neutral', group: 'movement_change_breaking', examples: ['fugitive', 'refuge', 'refugee'] },
  { text: 'frac / frag', meaning: 'break', charge: 'neutral', group: 'movement_change_breaking', examples: ['fragment', 'refract', 'fracture'] },
  { text: 'sequ', meaning: 'follow', charge: 'neutral', group: 'movement_change_breaking', examples: ['sequence', 'consequence', 'subsequent'] },
  { text: 'flor', meaning: 'flower', charge: 'positive', group: 'movement_change_breaking', examples: ['floral', 'florist', 'flourish'] },
  { text: 'cycl', meaning: 'circle / ring', charge: 'neutral', group: 'movement_change_breaking', examples: ['bicycle', 'cyclic', 'cyclone'] },
  // qualities_states
  { text: 'dur', meaning: 'hard / lasting', charge: 'neutral', group: 'qualities_states', examples: ['endure', 'duration', 'durable', 'obdurate'] },
  { text: 'domin', meaning: 'master', charge: 'neutral', group: 'qualities_states', examples: ['dominate', 'predominant'] },
  { text: 'crypt', meaning: 'hidden', charge: 'neutral', group: 'qualities_states', examples: ['cryptic', 'cryptogram'] },
  { text: 'idio', meaning: 'peculiar / distinct', charge: 'neutral', group: 'qualities_states', examples: ['idiosyncrasy', 'idiopathic'] },
  { text: 'derm', meaning: 'skin', charge: 'neutral', group: 'qualities_states', examples: ['epidermis', 'dermatitis'] },
];

// ── SUFFIXES ────────────────────────────────────────────────────────────────
const SUFFIXES = [
  { text: '-ous / -ose', meaning: 'makes an adjective', charge: N, group: 'suffix_partofspeech', examples: ['verbose', 'bellicose', 'garrulous'] },
  { text: '-ate', meaning: 'verb (to do) or adjective', charge: N, group: 'suffix_partofspeech', examples: ['ameliorate', 'placate', 'temperate'] },
  { text: '-ify / -fy', meaning: 'verb: to make', charge: N, group: 'suffix_partofspeech', examples: ['magnify', 'vilify', 'mollify'] },
  { text: '-ity / -ty', meaning: 'noun: a quality', charge: N, group: 'suffix_partofspeech', examples: ['paucity', 'veracity', 'brevity'] },
  { text: '-tion / -sion', meaning: 'noun: an action / result', charge: N, group: 'suffix_partofspeech', examples: ['aberration', 'profusion'] },
  { text: '-ent / -ant', meaning: 'adjective or agent-noun', charge: N, group: 'suffix_partofspeech', examples: ['prevalent', 'proponent'] },
  { text: '-esce / -escent', meaning: 'becoming / starting to', charge: N, group: 'suffix_partofspeech', examples: ['acquiesce', 'coalesce', 'nascent'] },
  { text: '-ism', meaning: 'noun: a belief / system', charge: N, group: 'suffix_partofspeech', examples: ['dogmatism', 'empiricism'] },
];

const MORPHEMES = [
  ...PREFIXES.map((m) => ({ ...m, type: 'prefix' })),
  ...ROOTS.map((m) => ({ ...m, type: 'root' })),
  ...SUFFIXES.map((m) => ({ ...m, type: 'suffix' })),
];

// ── HIGH-FREQUENCY WORDS ────────────────────────────────────────────────────
// word · pos · charge · definition · root_link (optional)
const WORDS = [
  { word: 'ambivalence', pos: 'noun', charge: 'neutral', definition: 'the state of having mixed or conflicting feelings', root_link: null },
  { word: 'tenuous', pos: 'adj', charge: 'negative', definition: 'weak, thin, barely holding together', root_link: null },
  { word: 'empirical', pos: 'adj', charge: 'positive', definition: 'based on observation and evidence', root_link: null },
  { word: 'dogmatic', pos: 'adj', charge: 'negative', definition: 'rigidly asserting opinion as fact; closed-minded', root_link: null },
  { word: 'ameliorate', pos: 'verb', charge: 'positive', definition: 'to make a bad situation better', root_link: null },
  { word: 'paucity', pos: 'noun', charge: 'negative', definition: 'a scarcity; too little of something', root_link: null },
  { word: 'profusion', pos: 'noun', charge: 'positive', definition: 'an abundance; a large quantity', root_link: null },
  { word: 'verisimilitude', pos: 'noun', charge: 'positive', definition: 'the quality of seeming true or real', root_link: null },
  { word: 'facile', pos: 'adj', charge: 'negative', definition: 'oversimplified; too easy to be meaningful', root_link: null },
  { word: 'surmise', pos: 'verb', charge: 'neutral', definition: 'to guess or infer from incomplete evidence', root_link: null },
  { word: 'abjure', pos: 'verb', charge: 'negative', definition: 'to formally renounce or reject', root_link: null },
  { word: 'buttress', pos: 'verb', charge: 'positive', definition: 'to support or strengthen', root_link: null },
  { word: 'corroborate', pos: 'verb', charge: 'positive', definition: 'to confirm with supporting evidence', root_link: 'fid' },
  { word: 'substantiate', pos: 'verb', charge: 'positive', definition: 'to back up with evidence', root_link: null },
  { word: 'refute', pos: 'verb', charge: 'neutral', definition: 'to prove wrong; disprove', root_link: null },
  { word: 'undermine', pos: 'verb', charge: 'negative', definition: 'to weaken gradually', root_link: null },
  { word: 'concede', pos: 'verb', charge: 'neutral', definition: 'to admit something is true after resisting', root_link: null },
  { word: 'reconcile', pos: 'verb', charge: 'neutral', definition: 'to make two conflicting things compatible', root_link: null },
  { word: 'disparage', pos: 'verb', charge: 'negative', definition: 'to belittle or criticize unfairly', root_link: 'dis-' },
  { word: 'candid', pos: 'adj', charge: 'positive', definition: 'honest and direct', root_link: null },
  { word: 'prudent', pos: 'adj', charge: 'positive', definition: 'wise and cautious', root_link: null },
  { word: 'meticulous', pos: 'adj', charge: 'positive', definition: 'extremely careful and precise', root_link: null },
  { word: 'eloquent', pos: 'adj', charge: 'positive', definition: 'fluent and persuasive in expression', root_link: 'loqu' },
  { word: 'cogent', pos: 'adj', charge: 'positive', definition: 'clear, logical, and convincing', root_link: null },
  { word: 'lucid', pos: 'adj', charge: 'positive', definition: 'clear and easy to understand', root_link: null },
  { word: 'plausible', pos: 'adj', charge: 'positive', definition: 'believable, reasonable', root_link: null },
  { word: 'pragmatic', pos: 'adj', charge: 'positive', definition: 'practical and realistic', root_link: null },
  { word: 'ambiguous', pos: 'adj', charge: 'negative', definition: 'open to more than one interpretation', root_link: null },
  { word: 'obscure', pos: 'adj', charge: 'negative', definition: 'unclear or little-known', root_link: null },
  { word: 'superfluous', pos: 'adj', charge: 'negative', definition: 'more than needed; unnecessary', root_link: null },
  { word: 'arbitrary', pos: 'adj', charge: 'negative', definition: 'based on whim rather than reason', root_link: null },
  { word: 'ephemeral', pos: 'adj', charge: 'negative', definition: 'short-lived, fleeting', root_link: null },
  { word: 'pervasive', pos: 'adj', charge: 'neutral', definition: 'spreading widely throughout', root_link: null },
  { word: 'inevitable', pos: 'adj', charge: 'neutral', definition: 'certain to happen; unavoidable', root_link: null },
  { word: 'indignant', pos: 'adj', charge: 'negative', definition: 'angry at something unfair', root_link: null },
  { word: 'skeptical', pos: 'adj', charge: 'negative', definition: 'doubtful, not easily convinced', root_link: null },
  { word: 'reticent', pos: 'adj', charge: 'neutral', definition: 'reserved; reluctant to speak', root_link: 'tacit' },
  { word: 'wistful', pos: 'adj', charge: 'negative', definition: 'gently sad and longing', root_link: null },
  { word: 'sardonic', pos: 'adj', charge: 'negative', definition: 'grimly mocking, bitter', root_link: null },
  { word: 'furtive', pos: 'adj', charge: 'negative', definition: 'secretive, sneaky', root_link: null },
  { word: 'overt', pos: 'adj', charge: 'neutral', definition: 'open, out in the open', root_link: null },
  { word: 'tentative', pos: 'adj', charge: 'negative', definition: 'uncertain, provisional, not final', root_link: null },
  { word: 'venerate', pos: 'verb', charge: 'positive', definition: 'to regard with great respect', root_link: 'vener' },
  { word: 'galvanize', pos: 'verb', charge: 'positive', definition: 'to spur into action', root_link: null },
  { word: 'mitigate', pos: 'verb', charge: 'positive', definition: 'to lessen the severity of', root_link: null },
  { word: 'alleviate', pos: 'verb', charge: 'positive', definition: 'to ease or relieve', root_link: null },
  { word: 'exacerbate', pos: 'verb', charge: 'negative', definition: 'to make worse', root_link: null },
  { word: 'nuance', pos: 'noun', charge: 'neutral', definition: 'a subtle distinction', root_link: null },
  { word: 'conjecture', pos: 'noun', charge: 'neutral', definition: 'a guess based on incomplete evidence', root_link: null },
  { word: 'inference', pos: 'noun', charge: 'neutral', definition: 'a conclusion drawn from evidence', root_link: null },
];

// False friends: SAT meaning ≠ everyday meaning. definition = SAT sense.
const FALSE_FRIENDS = [
  { word: 'qualify', pos: 'verb', charge: 'neutral', sat: 'to limit or soften a claim', everyday: 'to be eligible' },
  { word: 'novel', pos: 'adj', charge: 'positive', sat: 'new, original', everyday: 'a book' },
  { word: 'sound', pos: 'adj', charge: 'positive', sat: 'valid, solid, reliable', everyday: 'noise' },
  { word: 'improve', pos: 'verb', charge: 'neutral', sat: 'to increase (older sense)', everyday: 'to get better' },
  { word: 'arrest', pos: 'verb', charge: 'neutral', sat: 'to stop or halt', everyday: 'to detain' },
  { word: 'economy', pos: 'noun', charge: 'neutral', sat: 'efficiency, thrift', everyday: 'money/finance' },
  { word: 'reservation', pos: 'noun', charge: 'neutral', sat: 'a doubt or hesitation', everyday: 'a booking' },
];

// Won't-decode words: skip the chop method, use charge + a memory hook. These
// overlap the main list — they FLAG existing rows rather than adding new ones.
const NO_DECODE = [
  { word: 'buttress', hook: 'architecture: a wall support' },
  { word: 'sardonic', hook: 'a bitter, cruel smile' },
  { word: 'paucity', hook: 'sounds like "poverty"' },
  { word: 'furtive', hook: 'from "thief" — thief-like glances' },
];

/**
 * Resolve a root_link string to a morpheme id. The doc's link is a bare form
 * ("tacit", "dis-", "vener"); morpheme text can be a slash list ("tacit / tic")
 * or hyphenated ("dis-"). Normalize both to variants and match, preferring a
 * root over a prefix over a suffix when several fit.
 */
function makeResolver(morphemeRows) {
  const norm = (s) => s.trim().toLowerCase().replace(/^-+|-+$/g, '');
  const typeRank = { root: 0, prefix: 1, suffix: 2 };
  return (link) => {
    if (!link) return null;
    const target = norm(link);
    const matches = morphemeRows.filter((m) =>
      m.text.split('/').map(norm).includes(target),
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => typeRank[a.type] - typeRank[b.type]);
    return matches[0].id;
  };
}

async function upsertMorphemes() {
  for (const m of MORPHEMES) {
    await prisma.$executeRawUnsafe(
      `insert into public.morphemes (type, text, meaning, meaning_group, charge, example_words)
         values ($1::public.morpheme_type, $2, $3, $4, $5::public.morpheme_charge, $6::jsonb)
       on conflict (type, text) do update
         set meaning = excluded.meaning,
             meaning_group = excluded.meaning_group,
             charge = excluded.charge,
             example_words = excluded.example_words`,
      m.type,
      m.text,
      m.meaning,
      m.group,
      m.charge, // null passes through as SQL NULL for suffixes
      JSON.stringify(m.examples),
    );
  }
  const rows = await prisma.$queryRawUnsafe(
    `select id, type, text from public.morphemes`,
  );
  console.log(`  morphemes upserted: ${MORPHEMES.length} (db now holds ${rows.length})`);
  return rows;
}

/** Insert or update one default word by its (lowercased) spelling. */
async function upsertWord(w) {
  const existing = await prisma.$queryRawUnsafe(
    `select id from public.vocabulary_words where is_default and lower(word) = lower($1) limit 1`,
    w.word,
  );

  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      `update public.vocabulary_words set
         definition = $2, root_id = $3::uuid, charge = $4::public.word_charge, part_of_speech = $5,
         false_friend = $6, sat_meaning = $7, everyday_meaning = $8, no_decode = $9, memory_hook = $10
       where id = $1::uuid`,
      existing[0].id,
      w.definition, w.root_id, w.charge, w.pos,
      w.false_friend, w.sat_meaning, w.everyday_meaning, w.no_decode, w.memory_hook,
    );
    return 'updated';
  }

  await prisma.$executeRawUnsafe(
    `insert into public.vocabulary_words
       (user_id, is_default, word, definition, root_id, charge, part_of_speech,
        false_friend, sat_meaning, everyday_meaning, no_decode, memory_hook)
     values (null, true, $1, $2, $3::uuid, $4::public.word_charge, $5, $6, $7, $8, $9, $10)`,
    w.word, w.definition, w.root_id, w.charge, w.pos,
    w.false_friend, w.sat_meaning, w.everyday_meaning, w.no_decode, w.memory_hook,
  );
  return 'inserted';
}

async function main() {
  console.log('\n=== Seeding vocabulary corpus');

  const morphemeRows = await upsertMorphemes();
  const resolve = makeResolver(morphemeRows);

  // Fold the special sections into the canonical word rows before writing, so
  // each word is inserted exactly once with all its flags.
  const noDecode = new Map(NO_DECODE.map((n) => [n.word.toLowerCase(), n.hook]));

  const rows = [];

  for (const w of WORDS) {
    const hook = noDecode.get(w.word.toLowerCase()) ?? null;
    rows.push({
      word: w.word,
      pos: w.pos,
      charge: w.charge,
      definition: w.definition,
      root_id: resolve(w.root_link),
      false_friend: false,
      sat_meaning: null,
      everyday_meaning: null,
      no_decode: hook !== null,
      memory_hook: hook,
    });
  }

  for (const f of FALSE_FRIENDS) {
    rows.push({
      word: f.word,
      pos: f.pos,
      charge: f.charge,
      definition: f.sat, // the SAT sense is the operative meaning for exercises
      root_id: null,
      false_friend: true,
      sat_meaning: f.sat,
      everyday_meaning: f.everyday,
      no_decode: false,
      memory_hook: null,
    });
  }

  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const result = await upsertWord(r);
    if (result === 'inserted') inserted += 1;
    else updated += 1;
  }

  // Sanity: every root_link should have resolved.
  const unresolved = WORDS.filter((w) => w.root_link && !resolve(w.root_link));
  if (unresolved.length > 0) {
    console.log(`  ⚠️  unresolved root_links: ${unresolved.map((w) => w.root_link).join(', ')}`);
  }

  const linked = rows.filter((r) => r.root_id).length;
  console.log(
    `  words: ${inserted} inserted, ${updated} updated ` +
      `(${WORDS.length} core + ${FALSE_FRIENDS.length} false-friends, ${NO_DECODE.length} flagged no-decode, ${linked} root-linked)`,
  );

  console.log('\n=== Done.');
}

main()
  .catch((e) => {
    console.error('seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
