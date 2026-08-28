/**
 * Ingest the structured SAT **Math** question JSON into `public.questions`.
 *
 * Unlike the Reading & Writing ingest (`ingest-json-bank.mjs`, which flattens
 * HTML to whitelisted text), math stems are *self-contained rich HTML* —
 * MathML, inline SVG, base64 <img>, and <table> — where the markup carries the
 * meaning. So this script stores the stem/choice/rationale HTML **raw** and the
 * app renders it with a MathML-aware component (`<MathHtml>`). It only trims
 * outer whitespace; it never strips tags.
 *
 * Every row is written with `section = 'math'`. MCQ questions keep the A–D
 * `options`/`correct_answer` shape; SPR (student-produced response) questions
 * store `options = []`, `answer_format = 'spr'`, and their accepted answers in
 * `accepted_answers` (numeric-normalized here so the grader's job is small).
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/ingest-math-bank.mjs <file.json> [--update] [--dry-run]
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { reconcile, buildAcceptedAnswers } from './lib/spr-answer-reconcile.mjs';
import { renderGraphSvg, expandGraphMarkers } from '../src/lib/figures/graph-svg.mjs';
import { renderTableHtml, expandTableMarkers } from '../src/lib/figures/table-html.mjs';

/**
 * Build an id→rendered-HTML map for one source record from a single-spec field
 * and/or a map field, rendering each spec with `render`. Used for both figures:
 *   • graphs: single `graph`  + map `graphs`  (markers `{{graph}}` / `{{graph:ID}}`)
 *   • tables: single `table`  + map `tables`  (markers `{{table}}` / `{{table:ID}}`)
 * The single spec is stored under the default id (`kind`), which is what the bare
 * `{{graph}}` / `{{table}}` marker resolves to. Rendering here means a malformed
 * spec fails the whole ingest loudly instead of shipping a blank box.
 */
function buildFigures(src, kind, render) {
  const out = {};
  if (src[kind]) out[kind] = render(src[kind]);
  const mapField = src[kind + 's']; // "graphs" / "tables"
  if (mapField && typeof mapField === 'object') {
    for (const [id, spec] of Object.entries(mapField)) out[id] = render(spec);
  }
  return out;
}

/* domain code → question_domain enum value */
const DOMAIN_MAP = {
  H: 'algebra',
  P: 'advanced_math',
  Q: 'problem_solving_data_analysis',
  S: 'geometry_trigonometry',
};
const DIFFICULTY_MAP = { E: 'easy', M: 'medium', H: 'hard' };

/** Trim, and drop a wrapping the source sometimes leaves; keep all inner markup. */
function tidy(html) {
  return (html ?? '').trim();
}

/**
 * Normalize one SAT SPR answer token to the strings a user could type and have
 * accepted. Numbers/fractions pass through; "either 7, 8, or 13" is expanded to
 * its numbers. Word forms ("three halves") are kept verbatim — rare, and the
 * grader matches them literally.
 */
function expandAnswer(raw) {
  const s = String(raw).trim();
  const either = /^either\s+(.+)$/i.exec(s);
  if (either) {
    const nums = either[1].match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g);
    if (nums && nums.length) return nums;
  }
  return [s];
}

/** Distinct, order-preserving accepted-answer list for an SPR question. */
function acceptedAnswers(correctArr) {
  const out = [];
  for (const a of correctArr ?? []) {
    for (const v of expandAnswer(a)) {
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** Map one source record → a row, or a skip reason. */
export function mapMathQuestion(src) {
  const extId = src.external_id || src.questionId || null;

  const domain = DOMAIN_MAP[src.domain];
  if (!domain) return { skip: 'unmapped_domain', extId, detail: src.domain };

  const difficulty = DIFFICULTY_MAP[src.difficulty];
  if (!difficulty) return { skip: 'bad_difficulty', extId, detail: src.difficulty };

  // Declarative graphs and tables → inline SVG / HTML, placed wherever their
  // markers sit (or the default figure appended). A bad spec throws → caught by
  // the loop. `enrich` runs both expansions on any rich field (stem, choices,
  // rationale), so a figure marker works in whichever of them it appears.
  const graphSvgs = buildFigures(src, 'graph', renderGraphSvg);
  const tableHtml = buildFigures(src, 'table', renderTableHtml);
  const enrich = (html) => expandTableMarkers(expandGraphMarkers(tidy(html), graphSvgs), tableHtml);

  const question_text = enrich(src.stem);
  if (!question_text) return { skip: 'empty_stem', extId };

  const answer_format = src.type === 'spr' ? 'spr' : 'mcq';
  const content = src.content || {};
  const has_visual = Boolean(
    content.hasSvg ||
      content.hasImage ||
      content.hasTable ||
      Object.keys(graphSvgs).length ||
      Object.keys(tableHtml).length,
  );

  let options = [];
  let correct_answer = '';
  let accepted = null;

  if (answer_format === 'mcq') {
    const choices = Array.isArray(src.choices) ? src.choices : [];
    if (choices.length < 2) return { skip: 'no_choices', extId };
    options = choices.map((c) => ({ letter: c.id, text: enrich(c.body) }));
    const correctLetter =
      (Array.isArray(src.correct_answer) ? src.correct_answer[0] : src.correct_answer) ||
      choices.find((c) => c.correct)?.id;
    if (!correctLetter || !options.some((o) => o.letter === correctLetter)) {
      return { skip: 'no_correct_choice', extId };
    }
    correct_answer = correctLetter;
  } else {
    accepted = acceptedAnswers(src.correct_answer);
    if (accepted.length === 0) return { skip: 'no_spr_answer', extId };
    correct_answer = accepted[0];
  }

  // Guard: some source batches ship a grid-in answer as the integer truncation
  // of the real value ("1" for "1.5") — the explanation states the true answer
  // in plain text. Reconcile against the RAW rationale (so imaged fractions are
  // seen as images, not misread as integers): auto-correct the high-confidence
  // truncation case, and flag any other disagreement for review. Both are
  // reported by main() so a bad batch can never silently mis-grade.
  let reconciled = null;
  if (answer_format === 'spr') {
    const verdict = reconcile(accepted, src.rationale);
    if (verdict.status === 'truncated') {
      const before = correct_answer;
      accepted = buildAcceptedAnswers(verdict.correct);
      correct_answer = accepted[0];
      reconciled = { kind: 'fixed', extId, from: before, to: correct_answer };
    } else if (verdict.status === 'mismatch') {
      reconciled = { kind: 'review', extId, stored: verdict.stored.join('|'), stated: verdict.correct };
    }
  }

  return {
    reconciled,
    row: {
      external_id: extId,
      domain,
      skill: (src.skill_desc || '').trim() || null,
      difficulty,
      passage: null,
      question_text,
      options,
      correct_answer,
      accepted_answers: accepted,
      explanation: enrich(src.rationale) || null,
      has_visual,
      section: 'math',
      answer_format,
      active: typeof src.active === 'boolean' ? src.active : null,
    },
  };
}

/* ------------------------------ CLI + DB ------------------------------ */
const SOURCE_KEY = 'json:sat-math-full';
const BANK_NAME = 'SAT Math Question Bank';

function parseArgs(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') opts.update = true;
    else if (a === '--dry-run') opts.dryRun = true;
    // --batch <key> stamps every brand-new row (a not-yet-seen external_id) with
    // release_batch = <key>, so a Bluebook refresh can be shown as "New" without
    // reclassifying the original pool. Existing rows keep whatever batch they had.
    else if (a === '--batch') opts.batch = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else files.push(a);
  }
  if (files.length === 0) throw new Error('Provide at least one JSON file path.');
  return { files, opts };
}

const prisma = new PrismaClient();

async function resolveBank() {
  const existing = await prisma.$queryRawUnsafe(
    `select id from public.question_banks where source_file = $1 limit 1`,
    SOURCE_KEY,
  );
  if (existing.length > 0) return { id: existing[0].id, created: false };
  const created = await prisma.$queryRawUnsafe(
    `insert into public.question_banks (user_id, name, description, source_file, total_questions, is_default, section)
     values (null, $1, $2, $3, 0, true, 'math') returning id`,
    BANK_NAME,
    'Official SAT Math questions across Algebra, Advanced Math, Problem-Solving & Data Analysis, and Geometry & Trigonometry.',
    SOURCE_KEY,
  );
  return { id: created[0].id, created: true };
}

async function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));

  const source = [];
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    source.push(...arr);
    console.log(`loaded ${arr.length} from ${f}`);
  }

  const bank = opts.dryRun ? { id: null, created: false } : await resolveBank();
  if (opts.dryRun) console.log('\n[DRY RUN] mapping + validating only\n');
  else console.log(`\ntarget math bank ${bank.id} (${bank.created ? 'created' : 'existing'})\n`);

  const existingRows = opts.dryRun
    ? []
    : await prisma.$queryRawUnsafe(
        `select external_id from public.questions where bank_id = $1::uuid and external_id is not null`,
        bank.id,
      );
  const seen = new Set(existingRows.map((r) => r.external_id));

  const posRow = opts.dryRun
    ? [{ p: 0 }]
    : await prisma.$queryRawUnsafe(
        `select coalesce(max(position), 0)::int as p from public.questions where bank_id = $1::uuid`,
        bank.id,
      );
  let position = posRow[0].p;

  const report = { total: source.length, inserted: 0, mcq: 0, spr: 0, duplicates: 0, skipped: 0, failures: 0, reasons: {} };
  const bump = (k) => (report.reasons[k] = (report.reasons[k] || 0) + 1);
  const reconciledFixed = [];
  const reconciledReview = [];

  for (const src of source) {
    let mapped;
    try {
      mapped = mapMathQuestion(src);
    } catch (e) {
      report.failures++;
      console.log(`  ! ${src.external_id || src.questionId}: ${e.message}`);
      continue;
    }
    if (mapped.skip) {
      report.skipped++;
      bump(mapped.skip);
      continue;
    }
    if (mapped.reconciled?.kind === 'fixed') reconciledFixed.push(mapped.reconciled);
    else if (mapped.reconciled?.kind === 'review') reconciledReview.push(mapped.reconciled);
    const r = mapped.row;
    if (r.external_id && seen.has(r.external_id)) {
      if (opts.update && !opts.dryRun) {
        await prisma.$executeRawUnsafe(
          `update public.questions
              set question_text = $2, options = $3::jsonb, correct_answer = $4,
                  accepted_answers = $5::jsonb, explanation = $6, has_visual = $7,
                  answer_format = $8, skill = $9, active = $10
            where bank_id = $1::uuid and external_id = $11`,
          bank.id, r.question_text, JSON.stringify(r.options), r.correct_answer,
          r.accepted_answers ? JSON.stringify(r.accepted_answers) : null,
          r.explanation, r.has_visual, r.answer_format, r.skill, r.active, r.external_id,
        );
      } else {
        report.duplicates++;
      }
      continue;
    }
    if (r.external_id) seen.add(r.external_id);

    position += 1;
    if (!opts.dryRun) {
      try {
        await prisma.$executeRawUnsafe(
          `insert into public.questions
             (bank_id, user_id, external_id, position, domain, skill, difficulty,
              passage, question_text, options, correct_answer, explanation,
              has_visual, visual_data, extraction_status, is_default, visual_url,
              active, section, answer_format, accepted_answers, release_batch)
           values ($1::uuid, null, $2, $3, $4::question_domain, $5, $6::question_difficulty,
                   null, $7, $8::jsonb, $9, $10, $11, null, 'verified', true, null,
                   $12, 'math', $13, $14::jsonb, $15)`,
          bank.id, r.external_id, position, r.domain, r.skill, r.difficulty,
          r.question_text, JSON.stringify(r.options), r.correct_answer, r.explanation,
          r.has_visual, r.active, r.answer_format,
          r.accepted_answers ? JSON.stringify(r.accepted_answers) : null,
          opts.batch ?? null,
        );
      } catch (e) {
        report.failures++;
        console.log(`  ! insert failed for ${r.external_id}: ${e.message}`);
        position -= 1;
        continue;
      }
    }
    report.inserted++;
    if (r.answer_format === 'spr') report.spr++;
    else report.mcq++;
  }

  if (!opts.dryRun) {
    const countRow = await prisma.$queryRawUnsafe(
      `select count(*)::int as n from public.questions where bank_id = $1::uuid and extraction_status = 'verified'`,
      bank.id,
    );
    await prisma.$executeRawUnsafe(
      `update public.question_banks set total_questions = $2 where id = $1::uuid`,
      bank.id, countRow[0].n,
    );
  }

  console.log('\n================= math ingestion summary =================');
  console.log(`source questions:  ${report.total}`);
  console.log(
    `inserted:          ${report.inserted}  (mcq ${report.mcq}, spr ${report.spr})` +
      (opts.batch ? `  [tagged release_batch=${opts.batch}]` : ''),
  );
  console.log(`skipped duplicates:${report.duplicates}`);
  console.log(`skipped (mapping): ${report.skipped}`);
  console.log(`hard failures:     ${report.failures}`);
  if (Object.keys(report.reasons).length) {
    console.log('reasons:');
    for (const [k, v] of Object.entries(report.reasons)) console.log(`  ${k}: ${v}`);
  }
  if (reconciledFixed.length) {
    console.log(`\nSPR answers auto-corrected from explanation (${reconciledFixed.length}):`);
    for (const f of reconciledFixed) console.log(`  ${f.extId}: "${f.from}" → "${f.to}"`);
  }
  if (reconciledReview.length) {
    console.log(`\n⚠ SPR answers disagreeing with their explanation — review (${reconciledReview.length}):`);
    for (const m of reconciledReview) console.log(`  ${m.extId}: stored [${m.stored}] vs stated "${m.stated}"`);
  }
  console.log('==========================================================');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((e) => { console.error('ingestion failed:', e.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
