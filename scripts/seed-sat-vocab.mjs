/**
 * Seed the ~1000 SAT words (with their real, human-written example sentences)
 * from sat.vocab.md into the shared vocabulary_words corpus.
 *
 * The source is hand-authored markdown with real example sentences. Every
 * sentence is kept VERBATIM — the parser only strips markdown noise (`_`
 * emphasis, `<u>` tags, stray list bullets) and normalizes whitespace. It never
 * rewords, and never invents a sentence or definition.
 *
 * Entry format (one per word, occasionally multi-sense or wrapped across lines):
 *   word _(pos.)_ definition _(a real sentence using the word)_
 * Multi-sense words (`1. … 2. …`) keep the FIRST sense as the trainer item.
 *
 * These become is_default rows (user_id null), readable by everyone via the
 * public-read policy. Idempotent by upsert on lower(word) among the default
 * rows, so re-running merges the sentence onto any word already seeded from
 * sprep_vocab_seed_data.md (keeping that row's curated charge / root_id).
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-sat-vocab.mjs
 *   node scripts/seed-sat-vocab.mjs --dry     # parse-only, no DB
 */

import { readFileSync } from 'node:fs';

const SOURCE = '/Users/dufitimanaeric/Downloads/sat.vocab.md';
const DRY = process.argv.includes('--dry');

const POS = { v: 'verb', n: 'noun', adj: 'adj', adv: 'adv' };

/** Clean an extracted definition: drop emphasis underscores, tidy spacing. */
function cleanDefinition(raw) {
  return raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/[;,]$/, '');
}

/** Clean an extracted sentence: strip emphasis + stray list bullets, keep words. */
function cleanSentence(raw) {
  return raw
    .replace(/_/g, ' ') // emphasis markers
    .replace(/\s-\s/g, ' ') // stray "- " list bullets from wrapped lines (keeps Moby-Dick)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse the file into { word, partOfSpeech, definition, sentence } entries. */
export function parse(text) {
  const cleaned = text
    // Drop letter-section headers like "## **A**", "**B**", "### **C**".
    .replace(/^#{0,6}\s*\*\*[A-Za-z]\*\*\s*$/gm, '')
    // <u>…</u> only marks the highlighted word — including cases where the
    // closing paren got swallowed into it (…word.)</u>). Removing the tags
    // restores a normal ".)_" sentence terminator.
    .replace(/<\/?u>/g, '')
    // Collapse the whole file so entries wrapped across lines rejoin.
    .replace(/\s+/g, ' ');

  // word  [optional "1."]  _(pos.)_  definition  _(sentence)_
  const re = /(?:^|\s)([a-z][a-z'’-]*)\s+(?:\d\.\s*)?_\(([a-z]+)\.\)_\s*(.+?)\s*_\((.+?)\)_/g;

  const seen = new Set();
  const entries = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const word = m[1].toLowerCase();
    const pos = POS[m[2]] ?? m[2];
    const definition = cleanDefinition(m[3]);
    const sentence = cleanSentence(m[4]);

    if (!definition || !sentence) continue;
    if (seen.has(word)) continue; // first sense / first occurrence wins
    seen.add(word);

    entries.push({ word, partOfSpeech: pos, definition, sentence });
  }
  return entries;
}

async function main() {
  const text = readFileSync(SOURCE, 'utf8');
  const entries = parse(text);

  const withWord = entries.filter((e) => e.sentence.toLowerCase().includes(e.word.slice(0, Math.max(4, e.word.length - 2))));
  console.log(`Parsed ${entries.length} words.`);
  console.log(`  ${withWord.length} sentences contain the (stemmed) word for highlighting.`);
  console.log('  Samples:');
  for (const e of entries.slice(0, 3)) {
    console.log(`   • ${e.word} (${e.partOfSpeech}) — ${e.definition}`);
    console.log(`     “${e.sentence}”`);
  }

  if (DRY) {
    console.log('\n[dry run] No database writes.');
    return;
  }

  const { PrismaClient } = await import('@prisma/client');
  // Prefer the direct connection: this is a ~1000-row batch and the pooled
  // endpoint drops long-running prepared-statement bursts.
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });

  let inserted = 0;
  let merged = 0;
  try {
    // One round-trip to learn which words already exist (the curated overlap),
    // instead of a select per word.
    const existingRows = await prisma.$queryRawUnsafe(
      `select id, lower(word) as w from public.vocabulary_words where is_default`,
    );
    const existing = new Map(existingRows.map((r) => [r.w, r.id]));

    const toInsert = [];
    const toUpdate = [];
    for (const e of entries) {
      const id = existing.get(e.word.toLowerCase());
      if (id) toUpdate.push({ id, ...e });
      else toInsert.push(e);
    }

    // Bulk insert new words in chunks (multi-row VALUES), ~200 rows per statement.
    const CHUNK = 200;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      chunk.forEach((e, j) => {
        const b = j * 4;
        values.push(`(null, true, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
        params.push(e.word, e.definition, e.sentence, e.partOfSpeech);
      });
      await prisma.$executeRawUnsafe(
        `insert into public.vocabulary_words
           (user_id, is_default, word, definition, sentence, part_of_speech)
         values ${values.join(', ')}`,
        ...params,
      );
      inserted += chunk.length;
    }

    // The overlap with the curated seed is small — add the sentence, keep the
    // curated definition / part_of_speech.
    for (const e of toUpdate) {
      await prisma.$executeRawUnsafe(
        `update public.vocabulary_words
           set sentence = $2,
               definition = coalesce(definition, $3),
               part_of_speech = coalesce(part_of_speech, $4)
         where id = $1::uuid`,
        e.id, e.sentence, e.definition, e.partOfSpeech,
      );
      merged += 1;
    }

    console.log(`\nSeeded: ${inserted} new words, ${merged} merged onto existing rows.`);
  } catch (err) {
    console.error('seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the seed when invoked directly — importing `parse` has no side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
