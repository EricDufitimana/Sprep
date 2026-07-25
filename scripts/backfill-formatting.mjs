/**
 * One-shot backfill: re-apply the HTML→text mapping to already-ingested rows so
 * inline formatting now preserved by the pipeline — most importantly <u>
 * underlines (see scripts/ingest-json-bank.mjs, INLINE_KEEP) — lands in the
 * existing `public.questions` rows.
 *
 * This is the fast bulk equivalent of `ingest-json-bank.mjs --update`: it reuses
 * the exact same `mapQuestion` mapping, but writes every row in a handful of
 * `UPDATE … FROM unnest(...)` statements over the DIRECT (non-pooled)
 * connection instead of one round-trip per row. Idempotent — safe to re-run, and
 * matches rows by `external_id` so only questions from this JSON source are
 * touched, and only their four formatting-bearing columns.
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/backfill-formatting.mjs <file.json> [--bank "Bank name"]
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { mapQuestion } from './ingest-json-bank.mjs';

const CHUNK = 500;

function parseArgs(argv) {
  const files = [];
  const opts = { bank: 'SAT Question Bank (Full)' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bank') opts.bank = argv[++i];
    else if (a === '--source') opts.source = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else files.push(a);
  }
  if (files.length === 0) throw new Error('Provide at least one JSON file path.');
  opts.source = opts.source || `json:${opts.bank.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  return { files, opts };
}

// Prefer the direct connection for a bulk write; fall back to the pooled URL.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));

  const bankRows = await prisma.$queryRawUnsafe(
    `select id from public.question_banks where source_file = $1 limit 1`,
    opts.source,
  );
  if (bankRows.length === 0) throw new Error(`No bank with source_file "${opts.source}" — nothing to backfill.`);
  const bankId = bankRows[0].id;

  const src = [];
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    src.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }

  // Map every source record; keep only those that produced a row (same gate as
  // ingestion) and carry an external_id to match on.
  const rows = [];
  let skipped = 0;
  for (const s of src) {
    const mapped = mapQuestion(s);
    if (mapped.skip || !mapped.row.external_id) {
      skipped++;
      continue;
    }
    const r = mapped.row;
    rows.push([r.external_id, r.passage, r.question_text, JSON.stringify(r.options), r.explanation, r.active]);
  }

  // Ensure the `active` column exists (Bluebook live vs. disclosed). Idempotent.
  await prisma.$executeRawUnsafe(`alter table public.questions add column if not exists active boolean`);

  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const ids = chunk.map((r) => r[0]);
    const passages = chunk.map((r) => r[1]);
    const texts = chunk.map((r) => r[2]);
    const options = chunk.map((r) => r[3]);
    const expls = chunk.map((r) => r[4]);
    const actives = chunk.map((r) => r[5]);
    // One statement per chunk: unnest the parallel arrays into a virtual table
    // and join it to the target rows by external_id within this bank.
    const affected = await prisma.$executeRawUnsafe(
      `update public.questions q
          set passage = v.passage,
              question_text = v.question_text,
              options = v.options::jsonb,
              explanation = v.explanation,
              active = v.active
         from (
           select * from unnest(
             $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[]
           ) as t(external_id, passage, question_text, options, explanation, active)
         ) v
        where q.bank_id = $1::uuid and q.external_id = v.external_id`,
      bankId,
      ids,
      passages,
      texts,
      options,
      expls,
      actives,
    );
    updated += affected;
    console.log(`  chunk ${i / CHUNK + 1}: ${affected} rows updated`);
  }

  console.log('\n==================== backfill summary ====================');
  console.log(`bank:               ${bankId}`);
  console.log(`source records:     ${src.length}`);
  console.log(`mapped & matched:   ${rows.length}`);
  console.log(`skipped (unmapped): ${skipped}`);
  console.log(`rows updated:        ${updated}`);
  console.log('=========================================================');
}

main()
  .catch((e) => {
    console.error('backfill failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
