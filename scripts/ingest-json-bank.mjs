/**
 * Ingest a structured JSON question bank into `public.questions`.
 *
 * The source is a legitimately-sourced JSON array of already-structured SAT
 * Reading & Writing questions (NOT scraped PDFs/images), so this is a pure
 * data-mapping + validation task — it does NOT touch the vision-extraction
 * pipeline (`extract_questions_ai`). Each element looks like:
 *
 *   {
 *     "questionId": "f1bfbed3",
 *     "external_id": "52a8f1cb-...",
 *     "skill_cd": "INF",
 *     "difficulty": "H",
 *     "stem": "<p>… passage + question as HTML …</p>",
 *     "choices": [ { "id": "A", "body": "<p>…</p>", "correct": false }, … ],
 *     "rationale": "<p>… explanation as HTML …</p>"
 *   }
 *
 * Follows the sibling `seed-default-banks.mjs` convention: PrismaClient over a
 * direct Postgres connection (DATABASE_URL — a trusted local connection that
 * bypasses RLS, the service-role-equivalent for a local admin script), raw SQL
 * inserts with the same enum casts, and importing `.ts` utils directly.
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/ingest-json-bank.mjs <file.json> [more.json …] \
 *     [--bank "Bank name"] [--source <stable-key>] \
 *     [--bank-id <uuid>] [--user <uuid>] [--not-default]
 *
 * Defaults to a shared `is_default` bank (user_id NULL) named
 * "SAT Question Bank (Full)", keyed by a stable `source_file` so re-running is
 * idempotent at the bank level. Questions are de-duplicated by `external_id`
 * within the target bank (log-and-skip), so re-running on overlapping source
 * files never creates duplicate rows.
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { describeQuestions } from '../src/utils/bank-description.ts';

/* ------------------------------------------------------------------ *
 * skill_cd → { domain, skill }  (official digital SAT skill codes)
 * An unknown code is never guessed: the question is logged to `unmapped`
 * and skipped so the mapping can be extended before it is ingested.
 * ------------------------------------------------------------------ */
const SKILL_MAP = {
  CID: { domain: 'information_and_ideas', skill: 'Central Ideas & Details' },
  COE: { domain: 'information_and_ideas', skill: 'Command of Evidence (Textual)' },
  INF: { domain: 'information_and_ideas', skill: 'Inferences' },
  WIC: { domain: 'craft_and_structure', skill: 'Words in Context' },
  TSP: { domain: 'craft_and_structure', skill: 'Text Structure & Purpose' },
  CTC: { domain: 'craft_and_structure', skill: 'Cross-Text Connections' },
  RHS: { domain: 'expression_of_ideas', skill: 'Rhetorical Synthesis' },
  SYN: { domain: 'expression_of_ideas', skill: 'Rhetorical Synthesis' },
  TRA: { domain: 'expression_of_ideas', skill: 'Transitions' },
  BOU: { domain: 'standard_english_conventions', skill: 'Boundaries' },
  FSS: { domain: 'standard_english_conventions', skill: 'Form, Structure & Sense' },
};

const DIFFICULTY_MAP = { E: 'easy', M: 'medium', H: 'hard' };

/* ------------------------------------------------------------------ *
 * HTML → clean text
 * ------------------------------------------------------------------ */
const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&ensp;': ' ', '&emsp;': ' ', '&shy;': '',
  '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“',
  '&sbquo;': '‚', '&prime;': '′', '&Prime;': '″',
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&minus;': '−', '&times;': '×', '&le;': '≤', '&ge;': '≥',
  '&deg;': '°', '&copy;': '©', '&reg;': '®', '&trade;': '™',
  '&ordf;': 'ª', '&frac12;': '½',
  // accented Latin present in this corpus
  '&Aacute;': 'Á', '&aacute;': 'á', '&acirc;': 'â', '&aelig;': 'æ',
  '&atilde;': 'ã', '&auml;': 'ä', '&eacute;': 'é', '&ecirc;': 'ê',
  '&egrave;': 'è', '&euml;': 'ë', '&iacute;': 'í', '&igrave;': 'ì',
  '&iuml;': 'ï', '&ntilde;': 'ñ', '&oacute;': 'ó', '&ocirc;': 'ô',
  '&oslash;': 'ø', '&otilde;': 'õ', '&ouml;': 'ö', '&scaron;': 'š',
  '&uacute;': 'ú', '&uuml;': 'ü',
};
function decodeEntities(s) {
  return s
    .replace(/&[a-zA-Z]+;/g, (m) => (m in ENTITIES ? ENTITIES[m] : m))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeCodePoint(parseInt(n, 16)));
}
function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ *
 * Inline formatting preserved through the strip.
 * The SAT renders a handful of inline styles that carry meaning — most
 * importantly the <u>underlined phrase</u> that "which choice supports the
 * underlined sentence" questions refer to, plus italic titles (<em>), bold
 * (<strong>), and chemistry/math sub/superscripts. We keep exactly these,
 * normalized to their bare form (attributes dropped), so the marker survives
 * into the stored text and is interpreted by the <RichText> renderer. Every
 * other tag (spans, block wrappers, figures, …) is still removed.
 * ------------------------------------------------------------------ */
const INLINE_KEEP = new Set(['u', 'em', 'i', 'strong', 'b', 'sub', 'sup']);
function stripTagsKeepInline(s) {
  return s.replace(/<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*)?\/?>/g, (_, slash, name) => {
    const tag = name.toLowerCase();
    return INLINE_KEEP.has(tag) ? `<${slash}${tag}>` : '';
  });
}

/**
 * College Board marks the "underlined" portion a question refers to ("which
 * choice supports the underlined sentence") with an inline STYLE, not a <u> tag:
 *
 *   <span style="text-decoration: underline;" role="region" …>…the phrase…</span>
 *
 * Since spans are stripped, that underline was silently lost — leaving those
 * questions impossible to answer. Convert any element carrying a
 * `text-decoration: underline` style to a bare <u> BEFORE the span strip, so the
 * marker survives into the stored text and renders via <RichText>. The same-tag
 * backreference keeps the match balanced; the inner is non-greedy because these
 * wrap plain inline text (no nested same-tag). Runs before stripTagsKeepInline.
 */
function keepUnderline(html) {
  return html.replace(
    /<([a-z]+)\b[^>]*\bstyle="[^"]*text-decoration(?:-line)?:\s*underline[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi,
    '<u>$2</u>',
  );
}

/** Collapse runs of spaces per line, drop blank lines, trim. */
function collapse(s) {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Remove figures, raw SVG, and the sr-only long-description regions. */
function stripVisualBlocks(html) {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<figure[^>]*class="image"[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<figure[^>]*class="table"[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    .replace(/<div[^>]*class="sr-only"[^>]*role="region"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*role="region"[^>]*class="sr-only"[^>]*>[\s\S]*?<\/div>/gi, '');
}

/**
 * HTML fragment → clean readable text.
 * Drops screen-reader-only spans (e.g. the "blank" label), keeping the visible
 * `______` blank marker; turns block-close tags into line breaks; decodes
 * entities. Used for passage/question_text/options/explanation.
 */
function htmlToText(html) {
  let s = stripVisualBlocks(html);
  s = keepUnderline(s);
  s = s.replace(/<span[^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Turn list items into bulleted lines that survive the strip to plain text.
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|figcaption|caption|blockquote)>/gi, '\n');
  s = stripTagsKeepInline(s);
  s = decodeEntities(s);
  return collapse(s);
}

/** Inline HTML → single clean line (choices, table cells). */
function inlineText(html) {
  let s = keepUnderline(html);
  s = s.replace(/<span[^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/gi, '');
  s = s.replace(/<\/(p|div|li)>/gi, ' '); // block breaks → space (choices are usually one <p>)
  s = decodeEntities(stripTagsKeepInline(s));
  return s.replace(/[ \t\n\r\f]+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Stem splitting: passage + question prompt
 * Every prompt in this corpus is the final <p> and ends in "?"; the
 * prompt-pattern + last-paragraph fallback keep it robust to stragglers.
 * ------------------------------------------------------------------ */
const PROMPT_RE =
  /^(which choice|which finding|which quotation|which statement|which of the following|based on the (text|passage|table|graph|data)|the student (wants|would|is|notes)|according to the)/i;

function splitStem(cleanText) {
  const paras = cleanText.split('\n').map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return { passage: null, question_text: '' };
  let qIdx = -1;
  for (let i = paras.length - 1; i >= 0; i--) {
    if (paras[i].endsWith('?') || PROMPT_RE.test(paras[i])) {
      qIdx = i;
      break;
    }
  }
  if (qIdx === -1) qIdx = paras.length - 1;
  const question_text = paras[qIdx];
  const passage = paras.slice(0, qIdx).join('\n').trim() || null;
  return { passage, question_text };
}

/* ------------------------------------------------------------------ *
 * Visual data extraction
 * ------------------------------------------------------------------ */

/** Nested <ul>/<li> → indented readable lines. */
function listToText(html, depth = 0) {
  const lines = [];
  let i = 0;
  while (i < html.length) {
    const rel = html.slice(i).search(/<li[^>]*>/i);
    if (rel < 0) break;
    const openAt = i + rel;
    const open = html.slice(openAt).match(/<li[^>]*>/i)[0];
    const contentStart = openAt + open.length;
    // Find the matching </li>, honoring nested <li>.
    const re = /<\/?li[^>]*>/gi;
    re.lastIndex = contentStart;
    let d = 1;
    let end = html.length;
    let m;
    while ((m = re.exec(html))) {
      if (/^<li/i.test(m[0])) d++;
      else d--;
      if (d === 0) {
        end = m.index;
        break;
      }
    }
    const inner = html.slice(contentStart, end);
    const nestAt = inner.search(/<ul[^>]*>/i);
    const own = nestAt < 0 ? inner : inner.slice(0, nestAt);
    const ownText = inlineText(own).replace(/:$/, '');
    if (ownText) lines.push('  '.repeat(depth) + ownText);
    if (nestAt >= 0) lines.push(listToText(inner.slice(nestAt), depth + 1));
    i = end + 5;
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * Authoritative chart data from the sr-only long-description region.
 * This is the same structured data screen readers use, so it is ground truth,
 * not something needing review. Returns null when there is no such region.
 */
function extractSrOnly(stem) {
  const m =
    stem.match(/<div[^>]*class="sr-only"[^>]*role="region"[^>]*>([\s\S]*?)<\/div>/i) ||
    stem.match(/<div[^>]*role="region"[^>]*class="sr-only"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const openTag = stem.slice(m.index).match(/<div[^>]*>/i)[0];
  const label = openTag.match(/aria-label="([^"]*)"/i);
  let title = label ? decodeEntities(label[1]) : '';
  title = title.replace(/^Long description for\s*/i, '').replace(/\.\s*$/, '').trim();
  const body = listToText(m[1]);
  const out = [title, body].filter(Boolean).join('\n').trim();
  return out || null;
}

/** Authoritative data from an HTML <table> — literal cells, zero ambiguity. */
function extractTable(stem) {
  const t = stem.match(/<table[\s\S]*?<\/table>/i);
  if (!t) return null;
  const html = t[0];
  const cap = html.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  const title = cap ? inlineText(cap[1]) : '';
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let r;
  while ((r = trRe.exec(html))) {
    const cells = [];
    const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(r[1]))) cells.push(inlineText(c[2]));
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  const out = [title, ...rows].filter(Boolean).join('\n').trim();
  return out || null;
}

/**
 * Classify the visual, if any. Returns { hasVisual, visualData, kind }:
 *   - 'svg+data'    SVG chart WITH sr-only region → verified (authoritative data)
 *   - 'table'       HTML <table> → data extracted, but flagged needs_review
 *                   for a human pass before serving
 *   - 'svg-no-data' SVG/figure image WITHOUT a data block → needs_review, no data
 *   - 'none'        not a visual
 */
function detectVisual(stem) {
  const hasSvg = /<svg[\s>]/i.test(stem) || /<figure[^>]*class="image"/i.test(stem);
  const hasTable = /<table[\s>]/i.test(stem);
  if (hasSvg) {
    const data = extractSrOnly(stem);
    if (data) return { hasVisual: true, visualData: data, kind: 'svg+data' };
    return { hasVisual: true, visualData: null, kind: 'svg-no-data' };
  }
  if (hasTable) {
    // Table data is extracted for the reviewer, but not auto-verified.
    return { hasVisual: true, visualData: extractTable(stem), kind: 'table' };
  }
  return { hasVisual: false, visualData: null, kind: 'none' };
}

/* ------------------------------------------------------------------ *
 * Map one source record → a row (or a rejection).
 * ------------------------------------------------------------------ */
export function mapQuestion(src) {
  const extId = src.external_id || src.questionId || null;

  // Skill: unknown codes are never guessed — skip and log.
  const mapped = SKILL_MAP[src.skill_cd];
  if (!mapped) return { skip: 'unmapped_skill', extId, detail: src.skill_cd };

  // Difficulty: flag-and-skip on any unexpected value.
  const difficulty = DIFFICULTY_MAP[src.difficulty];
  if (!difficulty) return { skip: 'bad_difficulty', extId, detail: src.difficulty };

  const stem = src.stem || '';
  const visual = detectVisual(stem);

  // Passage + question prompt from the HTML remaining after visuals removed.
  const { passage, question_text } = splitStem(htmlToText(stem));
  if (!question_text) return { skip: 'empty_question', extId };

  // Options + correct answer.
  const choices = Array.isArray(src.choices) ? src.choices : [];
  const options = choices.map((c) => ({ letter: c.id, text: inlineText(c.body || '') }));
  const correctIds = choices.filter((c) => c.correct === true).map((c) => c.id);

  const reasons = [];
  let status = 'verified';

  // Structural gate applies regardless of how reliable the chart data is.
  if (choices.length !== 4 || correctIds.length !== 1) {
    status = 'needs_review';
    reasons.push('malformed_choices');
  }
  // Visual gating:
  //   svg+data → verified (screen-reader data is authoritative)
  //   table    → needs_review (data extracted, but a human confirms it)
  //   svg-no-data → needs_review (no reliable way to get the values)
  if (visual.kind === 'table') {
    status = 'needs_review';
    reasons.push('table_needs_review');
  } else if (visual.hasVisual && visual.kind !== 'svg+data') {
    status = 'needs_review';
    reasons.push('visual_needs_data');
  }

  const correct_answer = correctIds[0] ?? options[0]?.letter ?? 'A';

  // COE arrives tagged the same whether textual or quantitative; a COE question
  // carrying a graph/table is the quantitative variant.
  let skill = mapped.skill;
  if (src.skill_cd === 'COE') {
    skill = visual.hasVisual
      ? 'Command of Evidence (Quantitative)'
      : 'Command of Evidence (Textual)';
  }

  return {
    row: {
      external_id: extId,
      domain: mapped.domain,
      skill,
      difficulty,
      passage,
      question_text,
      options,
      correct_answer,
      explanation: htmlToText(src.rationale || '') || null,
      has_visual: visual.hasVisual,
      visual_data: visual.visualData,
      extraction_status: status,
      // Whether the question is still "active" in College Board's live Bluebook
      // (true) vs. disclosed/retired (false). Null when the source omits it.
      active: typeof src.active === 'boolean' ? src.active : null,
    },
    status,
    reasons,
    visualKind: visual.kind,
  };
}

/* ------------------------------------------------------------------ *
 * CLI + DB
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const files = [];
  const opts = { default: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bank') opts.bank = argv[++i];
    else if (a === '--source') opts.source = argv[++i];
    else if (a === '--bank-id') opts.bankId = argv[++i];
    else if (a === '--user') { opts.user = argv[++i]; opts.default = false; }
    else if (a === '--not-default') opts.default = false;
    else if (a === '--update') opts.update = true;
    else if (a === '--dry-run') opts.dryRun = true;
    // --batch <key>: stamp every brand-new row (a not-yet-seen external_id) with
    // release_batch = <key>, so a Bluebook refresh shows as "New" in the Question
    // Bank without reclassifying the original pool. Existing rows keep their batch.
    else if (a === '--batch') opts.batch = argv[++i];
    else if (a === '--print') { opts.dryRun = true; opts.print = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else files.push(a);
  }
  if (files.length === 0) throw new Error('Provide at least one JSON file path.');
  opts.bank = opts.bank || 'SAT Question Bank (Full)';
  opts.source = opts.source || `json:${slug(opts.bank)}`;
  return { files, opts };
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const prisma = new PrismaClient();

async function resolveBank(opts) {
  if (opts.bankId) {
    const rows = await prisma.$queryRawUnsafe(
      `select id, name from public.question_banks where id = $1::uuid limit 1`,
      opts.bankId,
    );
    if (rows.length === 0) throw new Error(`--bank-id ${opts.bankId} not found`);
    return { id: rows[0].id, created: false };
  }
  const existing = await prisma.$queryRawUnsafe(
    `select id from public.question_banks where source_file = $1 limit 1`,
    opts.source,
  );
  if (existing.length > 0) return { id: existing[0].id, created: false };

  const created = await prisma.$queryRawUnsafe(
    `insert into public.question_banks (user_id, name, description, source_file, total_questions, is_default)
     values ($1::uuid, $2, $3, $4, 0, $5) returning id`,
    opts.default ? null : opts.user,
    opts.bank,
    '', // filled in after we know the contents
    opts.source,
    opts.default,
  );
  return { id: created[0].id, created: true };
}

async function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));

  // Load + concatenate every source file (each is an array in the given shape).
  const source = [];
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    source.push(...arr);
    console.log(`loaded ${arr.length} from ${f}`);
  }

  const bank = opts.dryRun ? { id: null, created: false } : await resolveBank(opts);
  if (opts.dryRun) {
    console.log('\n[DRY RUN] no database writes — mapping + validating only\n');
  } else {
    console.log(
      `\ntarget bank ${bank.id} (${bank.created ? 'created' : 'existing'}) — ` +
        `${opts.default ? 'default/shared' : 'user ' + (opts.user ?? 'n/a')}\n`,
    );
  }

  // Existing external_ids in this bank → skip duplicates (log-and-skip).
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

  const report = {
    total: source.length,
    verified: 0,
    needsReview: 0,
    duplicates: 0,
    updated: 0,
    skipped: 0,
    failures: 0,
    reasons: {},
    unmapped: {},
    visualKinds: {},
    inserted: [], // for the created bank's description
  };
  const bump = (obj, key) => (obj[key] = (obj[key] || 0) + 1);

  for (const src of source) {
    let mapped;
    try {
      mapped = mapQuestion(src);
    } catch (e) {
      report.failures++;
      console.log(`  ! ${src.external_id || src.questionId}: ${e.message}`);
      continue;
    }

    if (mapped.skip) {
      report.skipped++;
      if (mapped.skip === 'unmapped_skill') bump(report.unmapped, mapped.detail);
      bump(report.reasons, mapped.skip);
      continue;
    }

    const r = mapped.row;

    // `--print <external_id|questionId>`: dump one fully-mapped row and stop.
    if (opts.print && (src.external_id === opts.print || src.questionId === opts.print)) {
      console.log(JSON.stringify({ status: mapped.status, reasons: mapped.reasons, visualKind: mapped.visualKind, ...r }, null, 2));
      return;
    }
    if (opts.print) continue;
    if (r.external_id && seen.has(r.external_id)) {
      // `--update`: refresh the text columns of an already-ingested row so a
      // change to the HTML→text mapping (e.g. now preserving <u> underlines)
      // is applied in place. Only the formatting-bearing columns are touched;
      // correctness, status, position and visuals are left untouched.
      if (opts.update && !opts.dryRun) {
        try {
          await prisma.$executeRawUnsafe(
            `update public.questions
                set passage = $2, question_text = $3, options = $4::jsonb, explanation = $5, active = $7
              where bank_id = $1::uuid and external_id = $6`,
            bank.id,
            r.passage,
            r.question_text,
            JSON.stringify(r.options),
            r.explanation,
            r.external_id,
            r.active,
          );
          report.updated++;
        } catch (e) {
          report.failures++;
          console.log(`  ! update failed for ${r.external_id}: ${e.message}`);
        }
      } else {
        report.duplicates++;
      }
      continue;
    }
    if (r.external_id) seen.add(r.external_id);
    bump(report.visualKinds, mapped.visualKind);

    position += 1;
    if (!opts.dryRun) {
      try {
        await prisma.$executeRawUnsafe(
          `insert into public.questions
             (bank_id, user_id, external_id, position, domain, skill, difficulty,
              passage, question_text, options, correct_answer, explanation,
              has_visual, visual_data, extraction_status, is_default, visual_url, active, release_batch)
           values ($1::uuid, $2::uuid, $3, $4, $5::question_domain, $6, $7::question_difficulty,
                   $8, $9, $10::jsonb, $11, $12, $13, $14, $15::extraction_status, $16, null, $17, $18)`,
          bank.id,
          opts.default ? null : opts.user,
          r.external_id,
          position,
          r.domain,
          r.skill,
          r.difficulty,
          r.passage,
          r.question_text,
          JSON.stringify(r.options),
          r.correct_answer,
          r.explanation,
          r.has_visual,
          r.visual_data,
          r.extraction_status,
          opts.default,
          r.active,
          opts.batch ?? null,
        );
      } catch (e) {
        report.failures++;
        console.log(`  ! insert failed for ${r.external_id}: ${e.message}`);
        position -= 1;
        continue;
      }
    }

    if (mapped.status === 'verified') report.verified++;
    else report.needsReview++;
    report.inserted.push({ domain: r.domain, difficulty: r.difficulty });
    if (mapped.reasons.length) mapped.reasons.forEach((x) => bump(report.reasons, x));
  }

  // Refresh the bank's total + (for a freshly-created bank) its description.
  let total = report.verified + report.needsReview;
  if (!opts.dryRun) {
    // total_questions tracks the sittable (verified) count, per app convention
    // (updateReviewedQuestion / insertExtractedQuestions set it the same way).
    const countRow = await prisma.$queryRawUnsafe(
      `select count(*)::int as n from public.questions where bank_id = $1::uuid and extraction_status = 'verified'`,
      bank.id,
    );
    total = countRow[0].n;
    if (bank.created && report.inserted.length) {
      const description = describeQuestions(report.inserted);
      await prisma.$executeRawUnsafe(
        `update public.question_banks set total_questions = $2, description = $3 where id = $1::uuid`,
        bank.id,
        total,
        description,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `update public.question_banks set total_questions = $2 where id = $1::uuid`,
        bank.id,
        total,
      );
    }
  }

  /* ---------------------------- report ---------------------------- */
  console.log('\n==================== ingestion summary ====================');
  console.log(`source questions:        ${report.total}`);
  console.log(
    `inserted (verified):     ${report.verified}` +
      (opts.batch ? `  [tagged release_batch=${opts.batch}]` : ''),
  );
  console.log(`inserted (needs_review): ${report.needsReview}`);
  if (opts.update) console.log(`updated (existing rows): ${report.updated}`);
  console.log(`skipped (duplicates):    ${report.duplicates}`);
  console.log(`skipped (not ingested):  ${report.skipped}`);
  console.log(`hard failures:           ${report.failures}`);
  console.log(`bank now holds:          ${total} questions total`);

  if (Object.keys(report.reasons).length) {
    console.log('\nreasons breakdown:');
    for (const [k, v] of Object.entries(report.reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
  }
  if (Object.keys(report.visualKinds).length) {
    console.log('\nvisual questions ingested:');
    for (const [k, v] of Object.entries(report.visualKinds)) {
      if (k !== 'none') console.log(`  ${k}: ${v}`);
    }
  }
  if (Object.keys(report.unmapped).length) {
    console.log('\n⚠ unmapped skill_cd (extend SKILL_MAP, then re-run):');
    for (const [k, v] of Object.entries(report.unmapped)) console.log(`  ${k}: ${v}`);
  }
  console.log('===========================================================');
}

// Only run the CLI when executed directly — importing this module (e.g. from
// scripts/backfill-formatting.mjs) reuses mapQuestion without ingesting.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((e) => {
      console.error('ingestion failed:', e.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
