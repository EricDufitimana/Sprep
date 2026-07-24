/**
 * Seed the two built-in SAT question banks from their College Board answer PDFs.
 *
 * Uses the exact same parser the upload flow uses (`src/utils/question-bank-parser.ts`),
 * so a seeded bank and an uploaded one are produced identically.
 *
 * These become `is_default` banks: `user_id` is null and every signed-in user
 * can read them (migration 20260723010000_default_banks.sql).
 *
 * Idempotent — re-running replaces each bank's questions rather than
 * duplicating them, matching on the stable `source_file` key.
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-default-banks.mjs
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { parseAnswerPdf } from '../src/utils/question-bank-parser.ts';
import { describeQuestions } from '../src/utils/bank-description.ts';
import { extractFigures, attributeFigures } from '../src/utils/pdf-figures.ts';

// Service role: built-in figures are owned by the app, not by a user.
const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
).storage.from('question-figures');

const ROOT = '/Users/dufitimanaeric/Downloads/SAT/Question Bank';

const BANKS = [
  {
    key: 'sat-question-bank-1',
    name: 'SAT Question Bank 1',
    pdf: `${ROOT}/Bank 1/Question Bank 1 Answers.pdf`,
  },
  {
    key: 'sat-question-bank-2',
    name: 'SAT Question Bank 2',
    pdf: `${ROOT}/Bank 2/Question Bank 2 Answers.pdf`,
  },
];

const prisma = new PrismaClient();

async function main() {
  for (const bank of BANKS) {
    console.log(`\n=== ${bank.name}`);
    const buf = readFileSync(bank.pdf);
    const { questions, problems } = await parseAnswerPdf(buf);

    // Charts live in the PDF as vector art; crop them out and upload so the
    // test screen can render the real figure instead of a prose description.
    const { figures, anchors } = await extractFigures(new Uint8Array(buf));
    const figuresByQuestion = attributeFigures(figures, anchors);
    console.log(`  figures found: ${figures.length} across ${figuresByQuestion.size} questions`);

    const figureUrls = new Map();
    for (const [externalId, figs] of figuresByQuestion) {
      const fig = figs[0];
      const path = `default/${bank.key}/${externalId}.png`;
      const { error: upErr } = await storage.upload(path, fig.png, {
        contentType: 'image/png',
        upsert: true,
      });
      if (upErr) {
        console.log(`  ! upload failed for ${externalId}: ${upErr.message}`);
        continue;
      }
      figureUrls.set(externalId, storage.getPublicUrl(path).data.publicUrl);
    }
    console.log(`  figures uploaded: ${figureUrls.size}`);

    if (problems.length > 0) console.log(`  ${problems.length} unparseable blocks skipped`);

    // Same derivation the upload flow uses, so seeded and uploaded banks match.
    const description = describeQuestions(questions);
    console.log(`  description: "${description}"`);
    if (questions.length === 0) {
      console.log('  nothing parsed — skipping');
      continue;
    }

    const existing = await prisma.$queryRawUnsafe(
      `select id from public.question_banks where source_file = $1 and is_default limit 1`,
      bank.key,
    );

    let bankId;
    if (existing.length > 0) {
      bankId = existing[0].id;
      await prisma.$executeRawUnsafe(`delete from public.questions where bank_id = $1::uuid`, bankId);
      await prisma.$executeRawUnsafe(
        `update public.question_banks set name = $2, description = $3, total_questions = $4 where id = $1::uuid`,
        bankId, bank.name, description, questions.length,
      );
      console.log(`  reusing bank ${bankId} (questions replaced)`);
    } else {
      const created = await prisma.$queryRawUnsafe(
        `insert into public.question_banks (user_id, name, description, source_file, total_questions, is_default)
         values (null, $1, $2, $3, $4, true) returning id`,
        bank.name, description, bank.key, questions.length,
      );
      bankId = created[0].id;
      console.log(`  created bank ${bankId}`);
    }

    for (const q of questions) {
      await prisma.$executeRawUnsafe(
        `insert into public.questions
           (bank_id, user_id, external_id, position, domain, skill, difficulty,
            passage, question_text, options, correct_answer, explanation,
            has_visual, visual_data, extraction_status, is_default, visual_url)
         values ($1::uuid, null, $2, $3, $4::question_domain, $5, $6::question_difficulty,
                 $7, $8, $9::jsonb, $10, $11, $12, null, 'verified'::extraction_status, true, $13)`,
        bankId,
        q.external_id,
        q.position,
        q.domain,
        q.skill,
        q.difficulty,
        q.passage,
        q.question_text,
        JSON.stringify(q.options),
        q.correct_answer,
        q.explanation,
        figureUrls.has(q.external_id),
        figureUrls.get(q.external_id) ?? null,
      );
    }

    console.log(`  inserted ${questions.length} verified questions`);
  }

  const summary = await prisma.$queryRawUnsafe(
    `select b.name, b.source_file, count(q.id)::int as questions
       from public.question_banks b
       left join public.questions q on q.bank_id = b.id
      where b.is_default
      group by b.id, b.name, b.source_file
      order by b.source_file`,
  );
  console.log('\n=== default banks now in the database');
  for (const row of summary) {
    console.log(`  ${row.name} (${row.source_file}) — ${row.questions} questions`);
  }
}

main()
  .catch((e) => {
    console.error('seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
