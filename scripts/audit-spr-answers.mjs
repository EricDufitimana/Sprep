/**
 * Audit (and optionally repair) SPR/grid-in answers in the live question bank.
 *
 * Each grid-in question stores its accepted answers in `accepted_answers`
 * (+ `correct_answer`), and its explanation states the real answer in plain
 * text. This script cross-checks the two using the shared reconciler and:
 *
 *   • reports every `truncated` answer (stored = the integer truncation of the
 *     real value, e.g. "1" for "1.5") — the high-confidence, auto-fixable bug;
 *   • reports every `mismatch` for human review (never auto-changed);
 *   • with `--fix`, rewrites the `truncated` rows to the real value plus its
 *     fraction form, straight from each row's own explanation.
 *
 * Usage:
 *   node scripts/audit-spr-answers.mjs            # report only (safe, read-only)
 *   node scripts/audit-spr-answers.mjs --fix      # apply the truncation repairs
 *
 * Run it after any bank refresh; it's idempotent — a clean bank reports nothing.
 */

import { PrismaClient } from '@prisma/client';
import { reconcile, buildAcceptedAnswers } from './lib/spr-answer-reconcile.mjs';

// Prefer the direct (non-pooler) connection for one-off scripts — the pgbouncer
// pooler in DATABASE_URL rejects the prepared statements Prisma issues here.
const prisma = new PrismaClient(
  process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : {},
);
const APPLY = process.argv.includes('--fix');

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    `select id, external_id, correct_answer, accepted_answers, explanation
       from public.questions
      where answer_format = 'spr'`,
  );

  const truncated = [];
  const mismatch = [];
  for (const r of rows) {
    const stored = r.accepted_answers ?? r.correct_answer;
    const verdict = reconcile(stored, r.explanation);
    if (verdict.status === 'truncated') truncated.push({ r, verdict });
    else if (verdict.status === 'mismatch') mismatch.push({ r, verdict });
  }

  console.log(`Scanned ${rows.length} SPR questions.`);
  console.log(`  truncated (auto-fixable): ${truncated.length}`);
  console.log(`  mismatch  (review only):  ${mismatch.length}\n`);

  if (truncated.length) {
    console.log('TRUNCATED — stored answer is the real answer with its decimals dropped:');
    for (const { r, verdict } of truncated) {
      const fixed = buildAcceptedAnswers(verdict.correct);
      console.log(
        `  ${r.external_id ?? r.id}: stored [${verdict.stored.join(', ')}] ` +
          `→ correct ${verdict.correct}  ⇒  [${fixed.join(', ')}]`,
      );
    }
    console.log('');
  }

  if (mismatch.length) {
    console.log('MISMATCH — stored answer disagrees with the explanation; review by hand:');
    for (const { r, verdict } of mismatch) {
      console.log(
        `  ${r.external_id ?? r.id}: stored [${verdict.stored.join(', ')}] ` +
          `vs explanation "${verdict.correct}"`,
      );
    }
    console.log('');
  }

  if (!APPLY) {
    console.log(
      truncated.length
        ? 'Report only. Re-run with --fix to apply the truncation repairs above.'
        : 'Nothing to fix. ✅',
    );
    return;
  }

  let applied = 0;
  for (const { r, verdict } of truncated) {
    const accepted = buildAcceptedAnswers(verdict.correct);
    await prisma.$executeRawUnsafe(
      `update public.questions
          set correct_answer = $1, accepted_answers = $2::jsonb
        where id = $3::uuid`,
      accepted[0],
      JSON.stringify(accepted),
      r.id,
    );
    applied += 1;
  }
  console.log(`Fixed ${applied} question(s). Re-run without --fix to confirm a clean scan.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
