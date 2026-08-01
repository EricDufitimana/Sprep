/**
 * Seed the full standard list of SAT prefixes, roots, and suffixes into the
 * shared `morphemes` corpus, with an accurate meaning for each.
 *
 * The source list (from the user) gives only the pieces and their type — no
 * meanings — so every meaning here is supplied and curated. Each entry also gets
 * a semantic `meaning_group` used by the Learn "browse" view and the by-family
 * progress rollups.
 *
 * Idempotent AND non-duplicating: the app already ships ~60 curated morphemes
 * (with charge + example words). Rather than ON CONFLICT (type,text) — which
 * would create a *second* row when the same piece is written with different
 * variants (existing "sequ" vs. this list's "sequ / secu") — we dedupe by
 * variant token within a type. If any existing morpheme of the same type shares
 * a bare variant (letters only, hyphens/slashes stripped), we SKIP it and keep
 * the richer existing row untouched. Only genuinely new pieces are inserted.
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-morphemes-standard.mjs
 *   node scripts/seed-morphemes-standard.mjs --dry     # print plan, no DB writes
 */

import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry');

// ── PREFIXES ────────────────────────────────────────────────────────────────
const PREFIXES = [
  ['a- / an-', 'without, not', 'negation'],
  ['ab- / abs-', 'away from', 'direction'],
  ['ad-', 'to, toward', 'direction'],
  ['ambi-', 'both', 'quantity_sameness'],
  ['ante-', 'before', 'time_order'],
  ['anti-', 'against, opposite', 'negation'],
  ['auto-', 'self', 'relation_self'],
  ['bene-', 'good, well', 'judgment_quality'],
  ['bi-', 'two', 'quantity_sameness'],
  ['bio-', 'life', 'body_health'],
  ['cata-', 'down', 'direction'],
  ['circum-', 'around', 'direction'],
  ['co- / com- / con-', 'together, with', 'relation_self'],
  ['contra- / counter-', 'against, opposite', 'negation'],
  ['de-', 'down, away, off', 'direction'],
  ['dia-', 'across, through', 'direction'],
  ['dis-', 'not, apart', 'negation'],
  ['dys-', 'bad, abnormal', 'judgment_quality'],
  ['e- / ex-', 'out, from', 'direction'],
  ['em- / en-', 'in, into, cause to', 'direction'],
  ['epi-', 'upon, over', 'direction'],
  ['eu-', 'good, well', 'judgment_quality'],
  ['extra-', 'outside, beyond', 'direction'],
  ['fore-', 'before, front', 'time_order'],
  ['geo-', 'earth', 'nature_world'],
  ['hetero-', 'different', 'quantity_sameness'],
  ['homo-', 'same', 'quantity_sameness'],
  ['hyper-', 'over, excessive', 'size_degree'],
  ['hypo-', 'under, too little', 'size_degree'],
  ['il- / im- / in- / ir-', 'not', 'negation'],
  ['inter-', 'between, among', 'direction'],
  ['intra-', 'within, inside', 'direction'],
  ['macro-', 'large, long', 'size_degree'],
  ['mal-', 'bad, wrongly', 'judgment_quality'],
  ['mega-', 'large, great', 'size_degree'],
  ['meta-', 'change, beyond', 'direction'],
  ['micro-', 'small', 'size_degree'],
  ['mid-', 'middle', 'direction'],
  ['mis-', 'wrong, badly', 'negation'],
  ['mono-', 'one, single', 'quantity_sameness'],
  ['multi-', 'many', 'quantity_sameness'],
  ['neo-', 'new', 'time_order'],
  ['non-', 'not', 'negation'],
  ['ob-', 'against, in the way', 'negation'],
  ['omni-', 'all', 'quantity_sameness'],
  ['pan-', 'all', 'quantity_sameness'],
  ['para-', 'beside, beyond', 'direction'],
  ['per-', 'through, thoroughly', 'direction'],
  ['peri-', 'around', 'direction'],
  ['poly-', 'many', 'quantity_sameness'],
  ['post-', 'after', 'time_order'],
  ['pre-', 'before', 'time_order'],
  ['pro-', 'forward, for', 'direction'],
  ['pseudo-', 'false', 'relation_self'],
  ['quasi-', 'seemingly, partly', 'relation_self'],
  ['re-', 'back, again', 'direction'],
  ['retro-', 'backward', 'direction'],
  ['semi-', 'half, partly', 'quantity_sameness'],
  ['sub-', 'under, below', 'direction'],
  ['super-', 'above, over', 'direction'],
  ['syn- / sym-', 'together, with', 'relation_self'],
  ['tele-', 'far, distant', 'direction'],
  ['trans-', 'across, beyond', 'direction'],
  ['tri-', 'three', 'quantity_sameness'],
  ['ultra-', 'beyond, excessive', 'size_degree'],
  ['un-', 'not', 'negation'],
  ['uni-', 'one', 'quantity_sameness'],
  ['vice-', 'in place of', 'relation_self'],
];

// ── SUFFIXES ────────────────────────────────────────────────────────────────
const SUFFIXES = [
  ['-able / -ible', 'adjective: capable of, able to be', 'suffix_partofspeech'],
  ['-acy', 'noun: state or quality', 'suffix_partofspeech'],
  ['-age', 'noun: action, result, or collection', 'suffix_partofspeech'],
  ['-al', 'adjective: relating to', 'suffix_partofspeech'],
  ['-ance / -ence', 'noun: state, quality, or action', 'suffix_partofspeech'],
  ['-ant / -ent', 'adjective or agent-noun', 'suffix_partofspeech'],
  ['-ary', 'adjective or noun: relating to', 'suffix_partofspeech'],
  ['-ate', 'verb (to do) or adjective', 'suffix_partofspeech'],
  ['-cide', 'noun: killing or killer', 'suffix_partofspeech'],
  ['-cracy', 'noun: rule, government', 'suffix_partofspeech'],
  ['-dom', 'noun: state, rank, or domain', 'suffix_partofspeech'],
  ['-eer', 'noun: one who does', 'suffix_partofspeech'],
  ['-en', 'verb: to make; or adjective: made of', 'suffix_partofspeech'],
  ['-er / -or', 'noun: one who or that which', 'suffix_partofspeech'],
  ['-esque', 'adjective: in the style of', 'suffix_partofspeech'],
  ['-ful', 'adjective: full of', 'suffix_partofspeech'],
  ['-hood', 'noun: state or condition', 'suffix_partofspeech'],
  ['-ian', 'noun or adjective: relating to, one who', 'suffix_partofspeech'],
  ['-ic', 'adjective: relating to, characteristic of', 'suffix_partofspeech'],
  ['-ify / -fy', 'verb: to make', 'suffix_partofspeech'],
  ['-ism', 'noun: a belief or system', 'suffix_partofspeech'],
  ['-ist', 'noun: one who does or believes', 'suffix_partofspeech'],
  ['-ity / -ty', 'noun: a quality or state', 'suffix_partofspeech'],
  ['-ive', 'adjective: tending to, having the nature of', 'suffix_partofspeech'],
  ['-ize / -ise', 'verb: to make or become', 'suffix_partofspeech'],
  ['-less', 'adjective: without', 'suffix_partofspeech'],
  ['-logy / -ology', 'noun: study of', 'suffix_partofspeech'],
  ['-ly', 'adverb: in a manner; or adjective: like', 'suffix_partofspeech'],
  ['-ment', 'noun: result or means of an action', 'suffix_partofspeech'],
  ['-ness', 'noun: state or quality', 'suffix_partofspeech'],
  ['-oid', 'adjective or noun: resembling', 'suffix_partofspeech'],
  ['-ous / -ious', 'adjective: full of, having', 'suffix_partofspeech'],
  ['-phobia', 'noun: fear of', 'suffix_partofspeech'],
  ['-ship', 'noun: state, skill, or office', 'suffix_partofspeech'],
  ['-some', 'adjective: tending to, causing', 'suffix_partofspeech'],
  ['-tion / -sion', 'noun: action or result', 'suffix_partofspeech'],
  ['-tude', 'noun: state or quality', 'suffix_partofspeech'],
  ['-ure', 'noun: action, result, or means', 'suffix_partofspeech'],
  ['-ward', 'adjective or adverb: in the direction of', 'suffix_partofspeech'],
  ['-y', 'adjective: characterized by; or noun', 'suffix_partofspeech'],
];

// ── ROOTS ─────────────────────────────────────────────────────────────────
const ROOTS = [
  ['anim', 'life, spirit, mind', 'body_health'],
  ['ann / enn', 'year', 'time_measure'],
  ['anthrop', 'human, mankind', 'people_self_life'],
  ['arch', 'chief, ruler; first', 'society_law'],
  ['aud', 'hear', 'belief_trust_judgment'],
  ['belli', 'war', 'society_law'],
  ['biblio', 'book', 'speaking_writing_silence'],
  ['bio', 'life', 'body_health'],
  ['cad / cas', 'fall', 'movement_change_breaking'],
  ['cede / ceed / cess', 'go, yield', 'movement_change_breaking'],
  ['chron', 'time', 'time_measure'],
  ['cide', 'kill, cut down', 'movement_change_breaking'],
  ['civ', 'citizen', 'society_law'],
  ['clam / claim', 'shout, cry out', 'speaking_writing_silence'],
  ['cogn', 'know', 'belief_trust_judgment'],
  ['corp', 'body', 'body_health'],
  ['duc / duct', 'lead', 'movement_change_breaking'],
  ['dynam', 'power, force', 'qualities_states'],
  ['equi', 'equal', 'time_measure'],
  ['fac / fact', 'make, do', 'action_making'],
  ['fer', 'carry, bear', 'movement_change_breaking'],
  ['fin', 'end, limit', 'time_measure'],
  ['flect / flex', 'bend', 'movement_change_breaking'],
  ['form', 'shape, form', 'action_making'],
  ['fort', 'strong', 'qualities_states'],
  ['fract / frag', 'break', 'movement_change_breaking'],
  ['grad / gress', 'step, go', 'movement_change_breaking'],
  ['grat', 'pleasing, thankful', 'feeling_love_calm'],
  ['greg', 'group, herd', 'people_self_life'],
  ['hema / hemo', 'blood', 'body_health'],
  ['hydr', 'water', 'nature_world'],
  ['ject', 'throw', 'movement_change_breaking'],
  ['jud / jur / jus', 'judge, law, right', 'society_law'],
  ['junct', 'join', 'action_making'],
  ['lat', 'carry, bear', 'movement_change_breaking'],
  ['leg', 'law; read', 'society_law'],
  ['liber', 'free', 'society_law'],
  ['liter', 'letter, writing', 'speaking_writing_silence'],
  ['loc', 'place', 'nature_world'],
  ['log / logue', 'word, speech; study', 'speaking_writing_silence'],
  ['luc', 'light', 'nature_world'],
  ['lud / lus', 'play, mock', 'qualities_states'],
  ['man', 'hand', 'body_health'],
  ['mand', 'order, command', 'society_law'],
  ['mania', 'madness, craze', 'feeling_love_calm'],
  ['mar / mari', 'sea', 'nature_world'],
  ['mater / matr', 'mother', 'people_self_life'],
  ['med', 'middle', 'nature_world'],
  ['memor', 'memory, mindful', 'belief_trust_judgment'],
  ['ment', 'mind', 'belief_trust_judgment'],
  ['merg / mers', 'dip, plunge', 'movement_change_breaking'],
  ['meter / metr', 'measure', 'time_measure'],
  ['min', 'small, less', 'time_measure'],
  ['mit / miss', 'send', 'movement_change_breaking'],
  ['mob / mot / mov', 'move', 'movement_change_breaking'],
  ['mor / mort', 'death', 'body_health'],
  ['morph', 'shape, form', 'action_making'],
  ['multi', 'many', 'time_measure'],
  ['nat', 'born, birth', 'body_health'],
  ['nav', 'ship, sail', 'nature_world'],
  ['nec / nic', 'death, harm', 'body_health'],
  ['neg', 'deny, say no', 'negation'],
  ['nom', 'name; law', 'speaking_writing_silence'],
  ['nov', 'new', 'time_measure'],
  ['nox / noc', 'harm', 'body_health'],
  ['omni', 'all', 'time_measure'],
  ['onym', 'name', 'speaking_writing_silence'],
  ['op / oper', 'work', 'action_making'],
  ['opt', 'sight; choose', 'belief_trust_judgment'],
  ['pac', 'peace', 'feeling_love_calm'],
  ['path', 'feeling; suffering, disease', 'feeling_love_calm'],
  ['patr / pater', 'father', 'people_self_life'],
  ['ped', 'foot; child', 'body_health'],
  ['pel / puls', 'drive, push', 'movement_change_breaking'],
  ['pend / pens', 'hang; weigh; pay', 'movement_change_breaking'],
  ['phobia', 'fear', 'feeling_love_calm'],
  ['phon', 'sound', 'speaking_writing_silence'],
  ['photo', 'light', 'nature_world'],
  ['plic', 'fold', 'action_making'],
  ['pod', 'foot', 'body_health'],
  ['pol', 'city, government', 'society_law'],
  ['poli', 'city', 'society_law'],
  ['port', 'carry', 'movement_change_breaking'],
  ['pos / pon', 'place, put', 'action_making'],
  ['prim', 'first', 'time_measure'],
  ['psych', 'mind, soul', 'belief_trust_judgment'],
  ['punct', 'point, prick', 'action_making'],
  ['quer / ques / quis', 'ask, seek', 'speaking_writing_silence'],
  ['reg', 'rule, king; straight', 'society_law'],
  ['rupt', 'break', 'movement_change_breaking'],
  ['sacr / sanct', 'holy, sacred', 'qualities_states'],
  ['sal', 'leap, jump', 'movement_change_breaking'],
  ['salv / salu', 'health, safety, save', 'body_health'],
  ['scend / scent / scens', 'climb', 'movement_change_breaking'],
  ['sci', 'know', 'belief_trust_judgment'],
  ['scope', 'look, examine', 'belief_trust_judgment'],
  ['scrib / script', 'write', 'speaking_writing_silence'],
  ['sect / sec', 'cut', 'action_making'],
  ['sed / sess / sid', 'sit, settle', 'movement_change_breaking'],
  ['sens / sent', 'feel, perceive', 'feeling_love_calm'],
  ['serv', 'keep, guard; serve', 'qualities_states'],
  ['sign', 'mark, sign', 'speaking_writing_silence'],
  ['simil / simul', 'like, similar', 'qualities_states'],
  ['sist', 'stand, stop', 'movement_change_breaking'],
  ['soci', 'companion, together', 'people_self_life'],
  ['sol', 'sun; alone', 'nature_world'],
  ['solv / solut', 'loosen, free', 'movement_change_breaking'],
  ['son', 'sound', 'speaking_writing_silence'],
  ['sper', 'hope', 'feeling_love_calm'],
  ['spir', 'breathe', 'body_health'],
  ['st / stat / sist', 'stand', 'movement_change_breaking'],
  ['strain / strict / string', 'bind, tighten', 'movement_change_breaking'],
  ['struct', 'build', 'action_making'],
  ['sui', 'self, oneself', 'people_self_life'],
  ['sume / sump', 'take, use', 'action_making'],
  ['tact / tang / ting / tig', 'touch', 'qualities_states'],
  ['tempor', 'time', 'time_measure'],
  ['ten / tin / tain', 'hold, keep', 'qualities_states'],
  ['tend / tens / tent', 'stretch, strain', 'movement_change_breaking'],
  ['term', 'end, boundary', 'time_measure'],
  ['terr', 'earth, land', 'nature_world'],
  ['test', 'witness, testify', 'society_law'],
  ['the / theo', 'god', 'belief_trust_judgment'],
  ['therm', 'heat', 'nature_world'],
  ['tort', 'twist', 'movement_change_breaking'],
  ['tract', 'drag, pull', 'movement_change_breaking'],
  ['trib', 'give, pay, allot', 'action_making'],
  ['trud / trus', 'thrust, push', 'movement_change_breaking'],
  ['turb', 'stir, agitate', 'movement_change_breaking'],
  ['typ', 'type, model, stamp', 'action_making'],
  ['ultima', 'last', 'time_measure'],
  ['und', 'wave, flow', 'nature_world'],
  ['urb', 'city', 'society_law'],
  ['vac', 'empty', 'qualities_states'],
  ['vad / vas', 'go, walk', 'movement_change_breaking'],
  ['val', 'strength, worth', 'qualities_states'],
  ['ven / vent', 'come', 'movement_change_breaking'],
  ['ver', 'truth', 'belief_trust_judgment'],
  ['verb', 'word', 'speaking_writing_silence'],
  ['vers / vert', 'turn', 'movement_change_breaking'],
  ['vict / vinc', 'conquer', 'qualities_states'],
  ['vid / vis', 'see', 'belief_trust_judgment'],
  ['viv / vit', 'live, life', 'body_health'],
  ['voc / vok', 'call, voice', 'speaking_writing_silence'],
  ['vol', 'wish, will', 'belief_trust_judgment'],
  ['volv / volut', 'roll, turn', 'movement_change_breaking'],
  ['vor', 'eat, devour', 'body_health'],
  ['xen', 'foreign, stranger', 'people_self_life'],
  ['zo', 'animal', 'body_health'],
];

const CATALOG = [
  ...PREFIXES.map(([text, meaning, group]) => ({ type: 'prefix', text, meaning, group })),
  ...SUFFIXES.map(([text, meaning, group]) => ({ type: 'suffix', text, meaning, group })),
  ...ROOTS.map(([text, meaning, group]) => ({ type: 'root', text, meaning, group })),
];

/** Bare variant tokens of a morpheme text: split on / and ,, strip hyphens/space. */
function variants(text) {
  return text
    .split(/[/,]/)
    .map((v) => v.trim().toLowerCase().replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

async function main() {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
  try {
    const existing = await prisma.$queryRawUnsafe(`select type, text from public.morphemes`);

    // Per-type set of variant tokens already present in the DB.
    const taken = { prefix: new Set(), root: new Set(), suffix: new Set() };
    for (const r of existing) for (const v of variants(r.text)) taken[r.type]?.add(v);

    const toInsert = [];
    const skipped = [];
    for (const m of CATALOG) {
      const vs = variants(m.text);
      const clash = vs.some((v) => taken[m.type].has(v));
      if (clash) {
        skipped.push(m.text);
        continue;
      }
      // Reserve these variants so later batch entries can't collide either.
      for (const v of vs) taken[m.type].add(v);
      toInsert.push(m);
    }

    console.log(`Catalog: ${CATALOG.length} pieces (${PREFIXES.length} prefixes, ${ROOTS.length} roots, ${SUFFIXES.length} suffixes)`);
    console.log(`Already present (skipped): ${skipped.length}`);
    console.log(`To insert: ${toInsert.length}`);

    if (DRY) {
      console.log('\n[dry run] Would insert:');
      for (const m of toInsert) console.log(`  ${m.type.padEnd(7)} ${m.text.padEnd(24)} — ${m.meaning}  [${m.group}]`);
      console.log('\nSkipped (already in corpus):', skipped.join(', '));
      return;
    }

    let inserted = 0;
    for (const m of toInsert) {
      await prisma.$executeRawUnsafe(
        `insert into public.morphemes (type, text, meaning, meaning_group, charge, example_words)
           values ($1::public.morpheme_type, $2, $3, $4, null, '[]'::jsonb)
         on conflict (type, text) do nothing`,
        m.type,
        m.text,
        m.meaning,
        m.group,
      );
      inserted += 1;
    }

    const total = await prisma.$queryRawUnsafe(`select count(*)::int c from public.morphemes`);
    console.log(`\nInserted ${inserted}. Corpus now holds ${total[0].c} morphemes.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('seed failed:', e.message);
  process.exitCode = 1;
});
