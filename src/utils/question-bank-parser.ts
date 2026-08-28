/**
 * Parse an answer document (PDF or Word) into structured questions.
 *
 * Deliberately not marked `server-only`: the core is a pure function over text
 * with no secrets, and the seeding script runs it under plain Node. Keep it out
 * of client components anyway — it pulls in pdf-parse / mammoth.
 *
 * Multiple layouts are supported through a small dispatcher (`parseText`), which
 * runs every deterministic format handler and keeps whichever recognised the
 * most questions:
 *
 *   1. College Board "Answers" export — self-describing blocks keyed by a hex
 *      `Question ID`, with `Correct Answer:` and a `Rationale`/`Domain`/`Skill`
 *      trailer. This is what the two built-in SAT banks are seeded from.
 *
 *   2. Labelled practice set — a looser, human-authored style: a `QUESTION <n>`
 *      header carrying the domain/skill/difficulty, options on their own line or
 *      inline, an `ANSWER: <A-D>` line and/or a `✓ CORRECT` marker, and an
 *      `Explanation` paragraph.
 *
 * When no deterministic handler recognises the text and an OpenAI key is
 * configured, `parseAnswerDocument` falls back to an LLM pass so an unfamiliar
 * layout still imports. New formats are added by appending to `TEXT_PARSERS`.
 */

// Figure engines (shared with the CLI ingest). Relative path — this module is
// also loaded under plain Node by the seed script, where the `@/` alias is not
// resolved. The `.mjs` engines are pure string builders with no dependencies.
import { renderGraphSvg, expandGraphMarkers } from '../lib/figures/graph-svg.mjs';
import { renderTableHtml, expandTableMarkers } from '../lib/figures/table-html.mjs';

export type QuestionDomain =
  // Reading & Writing
  | 'information_and_ideas'
  | 'craft_and_structure'
  | 'expression_of_ideas'
  | 'standard_english_conventions'
  // Math
  | 'algebra'
  | 'advanced_math'
  | 'problem_solving_data_analysis'
  | 'geometry_trigonometry';

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export interface ParsedOption {
  letter: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface ParsedQuestion {
  external_id: string;
  position: number;
  passage: string | null;
  question_text: string;
  options: ParsedOption[];
  /** MCQ: the correct letter. SPR (math grid-in): the first accepted answer. */
  correct_answer: string;
  explanation: string | null;
  difficulty: QuestionDifficulty | null;
  domain: QuestionDomain | null;
  skill: string | null;
  /**
   * Math-only fields. Absent/undefined on Reading & Writing questions, whose
   * import path is unchanged. See `parseJsonBank`'s math branch.
   */
  section?: 'reading_writing' | 'math';
  answer_format?: 'mcq' | 'spr';
  /** SPR accepted answers (numeric strings); null/undefined for MCQ. */
  accepted_answers?: string[] | null;
  /** True when the stem/choices carry a rendered figure (graph/table SVG/HTML). */
  has_visual?: boolean;
  /**
   * A Reading & Writing question's figure, as rendered inline HTML — for a `graph`
   * spec this is the baked `<svg>`. <QuestionFigure> renders it through the same
   * crisp path math uses (<MathHtml>), NOT as an image. (Math instead bakes its
   * figures directly into the stem HTML, so it leaves this undefined. R&W tables
   * are placed inline in the stem/passage text, which RichText already renders.)
   */
  visual_data?: string | null;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  /** Blocks that looked like questions but couldn't be parsed, with a reason. */
  problems: string[];
}

const DOMAIN_MAP: Record<string, QuestionDomain> = {
  'information and ideas': 'information_and_ideas',
  'craft and structure': 'craft_and_structure',
  'expression of ideas': 'expression_of_ideas',
  'standard english conventions': 'standard_english_conventions',
};

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * Import the library entry directly. pdf-parse's `index.js` runs a debug block
 * that reads a sample PDF when it thinks it's the main module — which is what
 * an ESM import looks like to it.
 */
async function extractText(buffer: Buffer): Promise<string> {
  // @ts-expect-error — no bundled types for the deep import path
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text;
}

function squash(s: string | undefined | null): string {
  return (s ?? '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/**
 * Turn PDF line-wrapping back into flowing prose.
 *
 * A PDF text layer records a newline at every *visual* line end, so a sentence
 * that wrapped in the original arrives pre-broken. Rendered as-is those become
 * hard breaks at arbitrary points mid-sentence, and words hyphenated across a
 * line ("high-\nresolution") stay split.
 */
/**
 * Repair intra-word gaps left by PDF kerning.
 *
 * Some glyph runs are positioned individually, and the text layer renders that
 * as whitespace inside a word — "pain's fier  y glow". Two or more spaces
 * before a one-or-two letter fragment is never real word spacing, so it's
 * rejoined. Single spaces are left alone.
 */
function healWordGaps(s: string): string {
  // Written without \p{L}/u: the tsconfig targets es5, where that flag is a
  // syntax error. The explicit range covers the accented Latin this corpus uses.
  //
  // Matches *horizontal* runs only ([ \t], not \s): a gap that spans a newline
  // is a line wrap, not kerning, and fusing "when \nit" into "whenit" would be
  // wrong. Reflow turns those wraps into single spaces afterwards.
  return s.replace(/([A-Za-z\u00C0-\u024F]{2,})[ \t]{2,}([A-Za-z\u00C0-\u024F]{1,2})\b/g, '$1$2');
}

function reflow(s: string): string {
  return healWordGaps(s)
    // Rejoin a word broken across lines: "high-\nresolution" -> "high-resolution".
    // The hyphen is kept — these are real hyphenated compounds in this corpus,
    // not typesetter hyphenation.
    .replace(/-\n(?=[a-z])/g, '-')
    // Every other newline is a wrap, not a paragraph.
    .replace(/\n+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Rebuild a passage, keeping verse line breaks but healing prose wraps.
 *
 * Prose and poetry are both newline-per-visual-line in the text layer, so
 * flattening everything destroys a poem's shape — and for a poetry question
 * the line breaks *are* the content. They're told apart by width: a wrapped
 * prose line runs nearly to the column edge, while verse stops early and
 * varies. `wrapWidth` is measured across the whole document so a passage
 * that is entirely verse is still recognised.
 */
function reflowPassage(lines: string[], wrapWidth: number): string {
  const shortLimit = wrapWidth * 0.62;
  const isShort = (l: string) => l.length < shortLimit;

  // Verse only counts as verse in a run — a single short line is just the
  // last line of a paragraph.
  const verse: boolean[] = lines.map(() => false);
  let i = 0;
  while (i < lines.length) {
    if (!isShort(lines[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isShort(lines[j])) j++;
    if (j - i >= 3) for (let k = i; k < j; k++) verse[k] = true;
    i = j;
  }

  const out: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) {
      out.push(reflow(buffer.join('\n')));
      buffer = [];
    }
  };

  for (let k = 0; k < lines.length; k++) {
    if (verse[k]) {
      flush();
      out.push(healWordGaps(lines[k]).replace(/ {2,}/g, ' ').trim());
    } else {
      buffer.push(lines[k]);
    }
  }
  flush();

  return out.join('\n').trim();
}

/**
 * Strip figure furniture that leaked into the passage.
 *
 * A chart's axis labels and a table's cells live in the same text layer as the
 * prose, so they arrive ahead of the passage. Table cells come through
 * concatenated with no separators ("Virginia spring beautystar chickweed0.4853")
 * — unreadable, and redundant once the figure renders as an image.
 *
 * The passage is taken to start at the first line that opens a real paragraph:
 * prose that either ends in sentence punctuation or is followed by more prose.
 * A figure's title is prose-length but is followed by labels, so it doesn't
 * qualify.
 *
 * Stripping only happens when the leading block actually looks like figure
 * furniture — it must contain a very short line. That guard protects a passage
 * that opens directly with verse, whose lines are short but never tiny.
 */
function stripFigureLabels(lines: string[]): string[] {
  const isProse = (l: string) => l.length >= 45;
  const endsSentence = (l: string) => /[.?!]["\u201d\u2019]?$/.test(l.trim());

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isProse(lines[i])) continue;
    if (endsSentence(lines[i]) || (i + 1 < lines.length && isProse(lines[i + 1]))) {
      start = i;
      break;
    }
  }

  if (start <= 0) return lines;

  const leading = lines.slice(0, start);
  const looksLikeFurniture = leading.some((l) => l.length < 20);
  return looksLikeFurniture ? lines.slice(start) : lines;
}

/** Options are prefixed `A.`/`B.`/`C.`/`D.` at a line start, in order. */
function parseOptions(body: string): { options: ParsedOption[]; stemEnd: number } | null {
  const found: { letter: (typeof LETTERS)[number]; start: number; marker: number }[] = [];

  for (const letter of LETTERS) {
    const re = new RegExp(`(^|\\n)\\s*${letter}\\.\\s`, 'g');
    const m = re.exec(body);
    if (!m) return null;
    found.push({ letter, start: m.index + m[0].length, marker: m.index });
  }

  for (let i = 1; i < found.length; i++) {
    if (found[i].marker < found[i - 1].marker) return null;
  }

  const options = found.map((cur, i) => {
    const end = i + 1 < found.length ? found[i + 1].marker : body.length;
    return { letter: cur.letter, text: reflow(squash(body.slice(cur.start, end))) };
  });

  return { options, stemEnd: found[0].marker };
}

/**
 * Parse the College Board "Answers" export.
 *
 * Recognised by its `Question ID <hex>` headers and `Correct Answer: <A-D>`
 * key lines. This is the format the two built-in SAT banks are seeded from.
 */
function parseCollegeBoardExport(rawText: string): ParseResult {
  // This handler reasons over plain prose; drop any inline formatting a .docx
  // source carried in so its regexes see clean text.
  const text = stripInlineTags(rawText);
  const headerRe = /Question ID ([0-9a-f]{6,12})/g;
  const marks: { id: string; start: number; headEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    marks.push({ id: m[1], start: m.index, headEnd: m.index + m[0].length });
  }

  // The column's wrap width, taken as the 90th percentile line length across
  // the document. Using a percentile rather than the max keeps one freak long
  // line from skewing it.
  const allLineLengths = text
    .split('\n')
    .map((l) => l.trim().length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const wrapWidth = allLineLengths.length
    ? allLineLengths[Math.floor(allLineLengths.length * 0.9)]
    : 100;

  const questions: ParsedQuestion[] = [];
  const problems: string[] = [];

  for (let i = 0; i < marks.length; i++) {
    const { id, headEnd } = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const block = text.slice(headEnd, end);

    const answerMatch = block.match(/Correct Answer:\s*([A-D])/);
    if (!answerMatch) {
      problems.push(`${id}: no "Correct Answer:" found`);
      continue;
    }

    // Everything before the "ID: <id> Answer" divider is the question itself.
    const dividerMatch = block.match(new RegExp(`ID:\\s*${id}\\s*Answer`));
    const questionPart =
      dividerMatch && dividerMatch.index !== undefined
        ? block.slice(0, dividerMatch.index)
        : block.slice(0, answerMatch.index);

    const cleaned = questionPart.replace(new RegExp(`^\\s*ID:\\s*${id}\\s*`), '');

    const parsed = parseOptions(cleaned);
    if (!parsed) {
      problems.push(`${id}: could not find four ordered options`);
      continue;
    }

    // The stem is the last line before option A; everything above is passage.
    const beforeOptions = cleaned.slice(0, parsed.stemEnd).trim();
    const rawLines = beforeOptions.split('\n').map((l) => l.trim()).filter(Boolean);
    const lines = stripFigureLabels(rawLines);
    const stem = lines.length > 0 ? lines[lines.length - 1] : '';
    // Heal prose wraps but keep verse line breaks intact.
    const passage = reflowPassage(
      lines.slice(0, -1).map((l) => l.replace(/\s+$/, '')).filter(Boolean),
      wrapWidth,
    );

    if (!stem) {
      problems.push(`${id}: empty question text`);
      continue;
    }

    const correct = answerMatch[1] as 'A' | 'B' | 'C' | 'D';
    if (!parsed.options.some((o) => o.letter === correct && o.text)) {
      problems.push(`${id}: correct answer ${correct} has no matching option`);
      continue;
    }

    const rationale = block.match(/Rationale\s*\n([\s\S]*?)\nQuestion Difficulty:/);
    const difficulty = block.match(/Question Difficulty:\s*(Easy|Medium|Hard)/i);
    const domain = block.match(/\nDomain\s*\n([\s\S]*?)\nSkill\s*\n/);
    const skill = block.match(/\nSkill\s*\n([\s\S]*?)\nDifficulty/);

    const domainRaw = squash(domain?.[1]).replace(/\n/g, ' ').toLowerCase();

    questions.push({
      external_id: id,
      position: questions.length + 1,
      passage: passage || null,
      question_text: reflow(stem),
      options: parsed.options,
      correct_answer: correct,
      explanation: reflow(squash(rationale?.[1])) || null,
      difficulty: difficulty
        ? (difficulty[1].toLowerCase() as QuestionDifficulty)
        : null,
      domain: DOMAIN_MAP[domainRaw] ?? null,
      skill: squash(skill?.[1]).replace(/\n/g, ' ') || null,
    });
  }

  return { questions, problems };
}

// ─────────────────────────────────────────────────────────────────────────────
// Labeled practice-set format
//
// A much looser, human-authored style than the College Board export. Each
// question is introduced by a `QUESTION <n>` header that often also carries the
// domain, skill, and difficulty; the correct answer is given by an `ANSWER: X`
// line and/or a `✓ CORRECT` marker beside the right option, and an
// `Explanation …` paragraph follows. Options may sit on their own line (just
// `A`) or lead their text inline (`A The vents offer …`), and markers may be
// written `A.`, `A)`, or `(A)`.
//
//   QUESTION 1   ·   Craft & Structure — Inferences   ·   Hard
//   <passage…>
//   <stem?>
//   A
//   <option A…>
//   B
//   <option B…>   ✓ CORRECT
//   …
//   ANSWER: B
//   Explanation <rationale…>
// ─────────────────────────────────────────────────────────────────────────────

/** Fold "&"/"and" and spacing so a header domain matches DOMAIN_MAP. */
function normalizeDomain(raw: string): QuestionDomain | null {
  const key = raw
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return DOMAIN_MAP[key] ?? null;
}

/** Drop repeated running headers/footers such as "… Practice Set   Page 3". */
function stripPageFurniture(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/\bPage\s+\d+\s*$/i.test(l.trim()))
    .join('\n');
}

/** Remove the "✓ CORRECT" answer marker (possibly split across a wrap). */
function stripCorrectMarker(s: string): string {
  return s
    .replace(/✓\s*CORRECT/gi, '')
    .replace(/✓/g, '')
    .replace(/\(\s*correct\s*(answer)?\s*\)/gi, '')
    .trim();
}

/**
 * A line that opens an answer option. Matches a bare letter (`A`), a labelled
 * one (`A.`, `A)`, `(A)`, `A:`), optionally followed by the option's text on the
 * same line. Returns the letter and any inline remainder.
 */
function matchOptionMarker(line: string): { letter: string; rest: string } | null {
  const m = /^\(?([A-D])[.)\]:]?(?:\s+(.*))?$/.exec(line.trim());
  if (!m) return null;
  return { letter: m[1], rest: (m[2] ?? '').trim() };
}

/**
 * Split the passage from the trailing question stem.
 *
 * The stem is the final sentence of the pre-option region — almost always an
 * interrogative. The split is the last sentence boundary before it, guarding
 * against decimals ("0.75") and single-letter abbreviations ("U.S.") that would
 * otherwise read as false boundaries.
 */
function splitPassageAndStem(flowed: string): { passage: string; stem: string } {
  const text = flowed.trim();
  if (!text) return { passage: '', stem: '' };

  const lastQ = text.lastIndexOf('?');
  const searchEnd = lastQ >= 0 ? lastQ : text.length - 1;

  let boundary = -1;
  for (let i = searchEnd - 1; i > 0; i--) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = text[i + 1];
    if (next !== ' ' && next !== '\n') continue;
    const prev = text[i - 1];
    // "…0.75" — a decimal point, not a sentence end.
    if (ch === '.' && /\d/.test(prev) && /\d/.test(text[i + 1] ?? '')) continue;
    // "…U.S." — an initialism; a lone capital before the dot.
    if (ch === '.' && /[A-Z]/.test(prev) && /[\s.]/.test(text[i - 2] ?? ' ')) continue;
    boundary = i;
    break;
  }

  if (boundary < 0) return { passage: '', stem: text };
  return {
    passage: text.slice(0, boundary + 1).trim(),
    stem: text.slice(boundary + 1).trim(),
  };
}

function parseLabeledSet(rawText: string): ParseResult {
  const cleaned = stripPageFurniture(stripInlineTags(rawText));

  // Block starts: a `QUESTION <n>` header. The rest of that line carries the
  // metadata (domain, skill, difficulty), so capture it whole.
  const headerRe = /(?:^|\n)\s*(?:QUESTION|Question)\s+(\d+)\b([^\n]*)/g;
  const marks: { n: number; meta: string; bodyStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(cleaned)) !== null) {
    marks.push({ n: Number(m[1]), meta: m[2] ?? '', bodyStart: m.index + m[0].length });
  }

  const questions: ParsedQuestion[] = [];
  const problems: string[] = [];

  for (let i = 0; i < marks.length; i++) {
    const { n, meta, bodyStart } = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].bodyStart : cleaned.length;
    // Re-find the next header start so the body excludes it.
    const body = cleaned.slice(bodyStart, i + 1 < marks.length ? findHeaderStart(cleaned, bodyStart, end) : end);

    // Header metadata: "· Craft & Structure — Inferences · Hard".
    let domain: QuestionDomain | null = null;
    let skill: string | null = null;
    let difficulty: QuestionDifficulty | null = null;
    for (const part of meta.split(/[·|]/).map((p) => p.trim()).filter(Boolean)) {
      if (/^(easy|medium|hard)$/i.test(part)) {
        difficulty = part.toLowerCase() as QuestionDifficulty;
      } else if (/[—–-]/.test(part)) {
        const [d, s] = part.split(/\s[—–-]\s/);
        if (d && !domain) domain = normalizeDomain(d);
        if (s && !skill) skill = squash(s);
      } else if (!domain) {
        domain = normalizeDomain(part);
      }
    }

    // The answer key: an explicit ANSWER/Correct line, else the ✓-marked option.
    // The letter must sit on the *same* line as the keyword — horizontal
    // whitespace only — so the stray "CORRECT" of a "✓ CORRECT" marker can't
    // reach across a newline and capture the next option's letter.
    const answerLine = body.match(
      /(?:^|\n)[ \t]*(?:ANSWER|Correct[ \t]+Answer|Answer|Correct)[ \t]*[:\-]?[ \t]*([A-D])\b/i,
    );
    const explanationMatch = body.match(/(?:^|\n)\s*(?:Explanation|Rationale|Why)\b[:\-.]?\s*([\s\S]*)$/i);

    // Options + passage live before the answer/explanation.
    const cut = Math.min(
      answerLine?.index ?? body.length,
      explanationMatch?.index ?? body.length,
    );
    const head = body.slice(0, cut);
    const lines = head.split('\n').map((l) => l.trim()).filter(Boolean);

    // Find option markers A→D in order, anchored from the end so a passage
    // line that happens to start with a capital letter can't be mistaken for
    // an option.
    const idx = findOptionIndices(lines);
    if (!idx) {
      problems.push(`Question ${n}: could not find four ordered options`);
      continue;
    }

    const [aI, bI, cI, dI] = idx;
    const bounds = [aI, bI, cI, dI, lines.length];
    let markedCorrect: string | null = null;
    const options: ParsedOption[] = LETTERS.map((letter, k) => {
      const startLine = lines[bounds[k]];
      const inline = matchOptionMarker(startLine)?.rest ?? '';
      const joined = [inline, ...lines.slice(bounds[k] + 1, bounds[k + 1])].filter(Boolean).join(' ');
      if (/✓|\(\s*correct/i.test(joined)) markedCorrect = letter;
      return { letter, text: reflow(squash(stripCorrectMarker(joined))) };
    });

    const correct = (answerLine?.[1]?.toUpperCase() ?? markedCorrect) as
      | 'A'
      | 'B'
      | 'C'
      | 'D'
      | null;
    if (!correct) {
      problems.push(`Question ${n}: no answer marked (ANSWER: line or ✓)`);
      continue;
    }
    if (!options.some((o) => o.letter === correct && o.text)) {
      problems.push(`Question ${n}: answer ${correct} has no matching option`);
      continue;
    }

    // Everything above option A is passage + stem.
    const preFlowed = reflow(lines.slice(0, aI).join('\n'));
    const { passage, stem } = splitPassageAndStem(preFlowed);
    if (!stem) {
      problems.push(`Question ${n}: empty question text`);
      continue;
    }

    questions.push({
      external_id: `q${n}`,
      position: questions.length + 1,
      passage: passage || null,
      question_text: stem,
      options,
      correct_answer: correct,
      explanation: explanationMatch ? reflow(squash(explanationMatch[1])) || null : null,
      difficulty,
      domain,
      skill,
    });
  }

  return { questions, problems };
}

/** Locate where the next `QUESTION <n>` header begins within [from, to). */
function findHeaderStart(text: string, from: number, to: number): number {
  const re = /(?:^|\n)\s*(?:QUESTION|Question)\s+\d+\b/g;
  re.lastIndex = from;
  const m = re.exec(text);
  return m && m.index < to ? m.index : to;
}

/**
 * Indices of the four option markers, in strict A<B<C<D order. Scans from the
 * end for D, then the last C before it, and so on — the option block is always
 * the final structured region before the answer key.
 */
function findOptionIndices(lines: string[]): [number, number, number, number] | null {
  const last = (letter: string, before: number): number => {
    for (let i = before - 1; i >= 0; i--) {
      const mm = matchOptionMarker(lines[i]);
      if (mm && mm.letter === letter) return i;
    }
    return -1;
  };
  const dI = last('D', lines.length);
  if (dI < 0) return null;
  const cI = last('C', dI);
  if (cI < 0) return null;
  const bI = last('B', cI);
  if (bI < 0) return null;
  const aI = last('A', bI);
  if (aI < 0) return null;
  return [aI, bI, cI, dI];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rich text: mammoth HTML → the viewer's formatting whitelist
//
// The .docx text layer is read as HTML (not raw text) so a word the author
// bolded, italicised, or underlined keeps that emphasis. `RichText` on the
// client understands a small tag whitelist; this collapses mammoth's output to
// exactly that: block ends become newlines, list items get a "• " marker,
// bold/italic/underline/sub/sup runs, tables, and <img> are kept, everything
// else drops.
// ─────────────────────────────────────────────────────────────────────────────

const KEEP_TAGS = new Set([
  'strong', 'em', 'u', 'sub', 'sup', 'br', 'img',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup',
]);

/** Only the inline formatting the viewer renders; used to clean text for the
 *  layout-inferring parsers, which reason over plain prose. */
const INLINE_TAG_RE = /<\/?(?:strong|b|em|i|u|sub|sup|br)\s*\/?>|<img\b[^>]*>/gi;

function stripInlineTags(s: string): string {
  return s.replace(INLINE_TAG_RE, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return '';
      }
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function htmlToRichText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  // Block boundaries become newlines; list items carry a bullet. Table tags are
  // left intact (kept in the whitelist) so the viewer can render a real table.
  s = s.replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '• ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Fold bold/italic aliases onto the canonical tags the viewer keys on.
  s = s.replace(/<(\/?)b\b[^>]*>/gi, '<$1strong>').replace(/<(\/?)i\b[^>]*>/gi, '<$1em>');
  // Reduce every <img> to a bare src/alt tag; drop sourceless ones.
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const url = (src?.[2] ?? src?.[3] ?? '').trim();
    if (!url) return '';
    const alt = /\balt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const altv = (alt?.[2] ?? alt?.[3] ?? '').replace(/"/g, '');
    return `\n<img src="${url}"${altv ? ` alt="${altv}"` : ''}>\n`;
  });
  // Drop any tag outside the whitelist (our normalised <img> survives).
  s = s.replace(/<\/?([a-zA-Z0-9]+)[^>]*>/g, (m, name) =>
    KEEP_TAGS.has(String(name).toLowerCase()) ? m : '',
  );
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Labeled-field format — the "safe", deterministic path
//
// A human-authored document (Word, or a JSON export) where every part of a
// question is introduced by an explicit label:
//
//   Passage: <stimulus…>                 (optional)
//   Question text: <stem…>
//   A: <option A…>
//   B: <option B…>
//   C: <option C…>
//   D: <option D…>
//   Answer: B
//   Explanation: <rationale…>            (optional)
//   Domain: … / Skill: … / Difficulty: … (optional)
//
// Because the boundaries are labelled rather than inferred, the passage and the
// stem can't bleed into each other the way a free-text PDF's do — the failure
// that put the whole question on one bolded side. Inline emphasis carried over
// from the .docx (via `htmlToRichText`) is preserved verbatim in each field.
// ─────────────────────────────────────────────────────────────────────────────

type LabeledField =
  | 'passage'
  | 'question_text'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'answer'
  | 'explanation'
  | 'domain'
  | 'skill'
  | 'difficulty';

/** Most-specific first, so "Difficulty"/"Domain" can't be read as option D. */
const LABEL_PATTERNS: [LabeledField, RegExp][] = [
  ['question_text', /^(?:question\s*text|question|stem|prompt)\s*[:.\-–—]/i],
  ['passage', /^(?:passage|stimulus|context)\s*[:.\-–—]/i],
  ['answer', /^(?:correct\s*answer|answer|correct|key)\s*[:.\-–—]/i],
  ['explanation', /^(?:explanation|rationale|reason|why)\s*[:.\-–—]/i],
  ['domain', /^domain\s*[:.\-–—]/i],
  ['skill', /^skill\s*[:.\-–—]/i],
  ['difficulty', /^difficulty\s*[:.\-–—]/i],
  ['A', /^(?:option\s*)?a\s*[:).\]\-–—]/i],
  ['B', /^(?:option\s*)?b\s*[:).\]\-–—]/i],
  ['C', /^(?:option\s*)?c\s*[:).\]\-–—]/i],
  ['D', /^(?:option\s*)?d\s*[:).\]\-–—]/i],
];

const LEADING_OPEN_TAG = /^<(?:strong|b|em|i|u|sub|sup)>\s*/i;
const LEADING_CLOSE_TAG = /^\s*<\/(?:strong|b|em|i|u|sub|sup)>\s*/i;

/**
 * If a line opens a labelled field, return the field and the text after the
 * label. A label may itself be emphasised in the source
 * (`<strong>Passage:</strong> …`), so leading inline tags are peeled off before
 * matching and the label's own closing tag is dropped from the value.
 */
function readLabel(line: string): { field: LabeledField; value: string } | null {
  let s = line.replace(/^\s+/, '');
  while (LEADING_OPEN_TAG.test(s)) s = s.replace(LEADING_OPEN_TAG, '');
  for (const [field, re] of LABEL_PATTERNS) {
    const m = re.exec(s);
    if (m) {
      const value = s.slice(m[0].length).replace(LEADING_CLOSE_TAG, '');
      return { field, value };
    }
  }
  return null;
}

/** Trim and tidy a field's text while keeping its inline tags and line breaks. */
function normalizeField(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}

interface FieldAcc {
  passage: string[];
  question_text: string[];
  A: string[];
  B: string[];
  C: string[];
  D: string[];
  answer: string[];
  explanation: string[];
  domain: string[];
  skill: string[];
  difficulty: string[];
  active: LabeledField | null;
  touched: boolean;
}

function newAcc(): FieldAcc {
  return {
    passage: [],
    question_text: [],
    A: [],
    B: [],
    C: [],
    D: [],
    answer: [],
    explanation: [],
    domain: [],
    skill: [],
    difficulty: [],
    active: null,
    touched: false,
  };
}

/** Fields whose value may wrap onto following unlabelled lines. */
const CONTINUABLE: LabeledField[] = [
  'passage',
  'question_text',
  'A',
  'B',
  'C',
  'D',
  'explanation',
];

function parseLabeledFields(text: string): ParseResult {
  const cleaned = stripPageFurniture(text);
  const lines = cleaned.split('\n');

  const questions: ParsedQuestion[] = [];
  const problems: string[] = [];
  let acc = newAcc();

  const startedBody = (a: FieldAcc) =>
    a.A.length > 0 || a.B.length > 0 || a.C.length > 0 || a.D.length > 0 || a.answer.length > 0;

  const flush = () => {
    if (!acc.touched) return;
    const built = buildLabeled(acc, questions.length + 1);
    if ('error' in built) problems.push(built.error);
    else questions.push(built.question);
    acc = newAcc();
  };

  const headerRe = /^\s*(?:question|q)\s*#?\s*\d+\s*[).:\-]?\s*$/i;

  for (const line of lines) {
    // A bare "Question 3" / "Q3" header (never "Question text:") ends a block.
    if (headerRe.test(stripInlineTags(line))) {
      flush();
      continue;
    }

    const label = readLabel(line);
    if (label) {
      const { field, value } = label;
      // A fresh passage always opens a question; a fresh stem opens one unless
      // it's the stem for a passage already in progress.
      if (
        (field === 'passage' &&
          (acc.passage.length > 0 || acc.question_text.length > 0 || startedBody(acc))) ||
        (field === 'question_text' && (acc.question_text.length > 0 || startedBody(acc)))
      ) {
        flush();
      }
      acc.touched = true;
      acc.active = field;
      if (value.trim()) acc[field].push(value);
      continue;
    }

    // Continuation of the field currently being read.
    if (acc.active && CONTINUABLE.includes(acc.active) && line.trim()) {
      acc[acc.active].push(line);
    }
  }
  flush();

  return { questions, problems };
}

function buildLabeled(
  acc: FieldAcc,
  position: number,
): { question: ParsedQuestion } | { error: string } {
  const label = `Question ${position}`;
  const question_text = normalizeField(acc.question_text.join('\n'));
  const passage = normalizeField(acc.passage.join('\n'));

  if (!question_text) return { error: `${label}: no "Question text:" label found` };

  const options: ParsedOption[] = LETTERS.map((letter) => ({
    letter,
    text: normalizeField(acc[letter].join('\n')),
  }));
  const missing = options.filter((o) => !o.text).map((o) => o.letter);
  if (missing.length) {
    return { error: `${label}: missing option${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` };
  }

  const answerMatch = /([A-D])/i.exec(stripInlineTags(acc.answer.join(' ')));
  if (!answerMatch) return { error: `${label}: no answer (A–D) given` };
  const correct = answerMatch[1].toUpperCase() as ParsedOption['letter'];
  if (!options.some((o) => o.letter === correct && o.text)) {
    return { error: `${label}: answer ${correct} has no matching option` };
  }

  const difficultyRaw = stripInlineTags(acc.difficulty.join(' ')).toLowerCase();
  const difficulty =
    (['easy', 'medium', 'hard'] as const).find((d) => difficultyRaw.includes(d)) ?? null;
  const skill = stripInlineTags(acc.skill.join(' ')).replace(/\s+/g, ' ').trim();

  return {
    question: {
      external_id: `l${position}`,
      position,
      passage: passage || null,
      question_text,
      options,
      correct_answer: correct,
      explanation: normalizeField(acc.explanation.join('\n')) || null,
      difficulty,
      domain: normalizeDomain(stripInlineTags(acc.domain.join(' '))),
      skill: skill || null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON bank format — an uploaded .json file
//
// The most reliable path of all: the questions arrive already structured, so
// there is no layout to infer. Field text may carry the same inline-formatting
// whitelist as everything else. `options` is accepted as an array of
// {letter,text}, an array of plain strings (A–D in order), or an object keyed
// by letter; the answer as `correct_answer` or `answer`.
// ─────────────────────────────────────────────────────────────────────────────

function coerceJsonOptions(raw: unknown): ParsedOption[] {
  if (Array.isArray(raw)) {
    if (raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null) {
      const out: ParsedOption[] = [];
      for (const o of raw as Record<string, unknown>[]) {
        const letter = String(o?.letter ?? '').toUpperCase();
        if (!LETTERS.includes(letter as ParsedOption['letter'])) continue;
        out.push({ letter: letter as ParsedOption['letter'], text: normalizeField(String(o?.text ?? '')) });
      }
      return out;
    }
    return (raw as unknown[]).slice(0, 4).map((t, i) => ({
      letter: LETTERS[i],
      text: normalizeField(String(t ?? '')),
    }));
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return LETTERS.filter((l) => obj[l] != null || obj[l.toLowerCase()] != null).map((l) => ({
      letter: l,
      text: normalizeField(String(obj[l] ?? obj[l.toLowerCase()] ?? '')),
    }));
  }
  return [];
}

/* domain code → math question_domain enum (matches scripts/ingest-math-bank.mjs). */
const MATH_DOMAIN_MAP: Record<string, QuestionDomain> = {
  H: 'algebra',
  P: 'advanced_math',
  Q: 'problem_solving_data_analysis',
  S: 'geometry_trigonometry',
};
const MATH_DIFFICULTY_MAP: Record<string, QuestionDifficulty> = {
  E: 'easy',
  M: 'medium',
  H: 'hard',
};

/**
 * Is this record in the structured *math* format (our LaTeX shape) rather than
 * the Reading & Writing shape? Signalled by an explicit `type` of mcq/spr,
 * choices carrying `body` (vs R&W's `text`), or a single-letter math `domain`
 * code. NOTE: a `graph`/`table` spec is NOT a signal — both sections use the same
 * figure engines (an R&W data question can carry a chart or table), so keying on
 * them would mis-route English questions. R&W records have none of the signals
 * below, so this never diverts an English question.
 */
function isMathRecord(raw: Record<string, unknown>): boolean {
  if (raw.type === 'spr' || raw.type === 'mcq') return true;
  if (typeof raw.domain === 'string' && raw.domain in MATH_DOMAIN_MAP) return true;
  const choices = raw.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object' && 'body' in choices[0]) {
    return true;
  }
  return false;
}

/** Distinct, order-preserving accepted-answer list for an SPR question. */
function acceptedAnswers(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const a of list) {
    const s = String(a).trim();
    // "either 7, 8, or 13" → its numbers; otherwise keep the token verbatim.
    const either = /^either\s+(.+)$/i.exec(s);
    const parts = either ? (either[1].match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) ?? [s]) : [s];
    for (const v of parts) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Map one structured *math* record → a ParsedQuestion (or a problem string).
 * Math stems are rich HTML (LaTeX + baked graph/table SVG/HTML), so they are
 * kept RAW — never run through the R&W text flattener — and rendered by
 * <MathHtml>. Figure specs (`graph`/`graphs`/`table`/`tables`) are expanded into
 * their `{{graph}}`/`{{table}}` markers here, exactly as the CLI ingest does.
 */
function mapMathJsonRecord(raw: Record<string, unknown>, n: number): ParsedQuestion | { problem: string } {
  const domain = typeof raw.domain === 'string' ? MATH_DOMAIN_MAP[raw.domain] ?? null : null;
  const diffCode = String(raw.difficulty ?? '');
  const difficulty =
    MATH_DIFFICULTY_MAP[diffCode] ??
    (['easy', 'medium', 'hard'].includes(diffCode.toLowerCase())
      ? (diffCode.toLowerCase() as QuestionDifficulty)
      : null);

  // Render any declarative figures, then expand their markers in each field.
  let graphs: Record<string, string> = {};
  let tables: Record<string, string> = {};
  try {
    if (raw.graph) graphs.graph = renderGraphSvg(raw.graph);
    if (raw.graphs && typeof raw.graphs === 'object') {
      for (const [id, spec] of Object.entries(raw.graphs as Record<string, unknown>)) {
        graphs[id] = renderGraphSvg(spec);
      }
    }
    if (raw.table) tables.table = renderTableHtml(raw.table);
    if (raw.tables && typeof raw.tables === 'object') {
      for (const [id, spec] of Object.entries(raw.tables as Record<string, unknown>)) {
        tables[id] = renderTableHtml(spec);
      }
    }
  } catch (e) {
    return { problem: `Question ${n}: bad figure spec — ${e instanceof Error ? e.message : 'invalid'}` };
  }
  const enrich = (html: unknown): string =>
    expandTableMarkers(expandGraphMarkers(String(html ?? '').trim(), graphs), tables);

  const question_text = enrich(raw.stem ?? raw.question_text ?? raw.question);
  if (!question_text) return { problem: `Question ${n}: missing stem` };

  const hasVisual = Object.keys(graphs).length > 0 || Object.keys(tables).length > 0;
  const format: 'mcq' | 'spr' = raw.type === 'spr' ? 'spr' : 'mcq';

  if (format === 'spr') {
    const accepted = acceptedAnswers(raw.correct_answer ?? raw.answer);
    if (accepted.length === 0) return { problem: `Question ${n}: SPR question has no accepted answer` };
    return {
      external_id: String(raw.external_id ?? `m${n}`),
      position: n,
      passage: null,
      question_text,
      options: [],
      correct_answer: accepted[0],
      explanation: enrich(raw.rationale ?? raw.explanation) || null,
      difficulty,
      domain,
      skill: raw.skill_desc ? String(raw.skill_desc).trim() : raw.skill ? String(raw.skill).trim() : null,
      section: 'math',
      answer_format: 'spr',
      accepted_answers: accepted,
      has_visual: hasVisual,
    };
  }

  // MCQ: choices use {id, body}; keep bodies raw so LaTeX/figures survive.
  const choices = Array.isArray(raw.choices) ? (raw.choices as Record<string, unknown>[]) : [];
  if (choices.length < 2) return { problem: `Question ${n}: needs at least two choices` };
  const options: ParsedOption[] = choices.map((c) => ({
    letter: String(c.id ?? '').toUpperCase() as ParsedOption['letter'],
    text: enrich(c.body),
  }));
  const correctLetter = String(
    (Array.isArray(raw.correct_answer) ? raw.correct_answer[0] : raw.correct_answer) ??
      choices.find((c) => c.correct === true)?.id ??
      '',
  ).toUpperCase();
  if (!options.some((o) => o.letter === correctLetter && o.text)) {
    return { problem: `Question ${n}: correct answer "${correctLetter}" has no matching choice` };
  }

  return {
    external_id: String(raw.external_id ?? `m${n}`),
    position: n,
    passage: null,
    question_text,
    options,
    correct_answer: correctLetter,
    explanation: enrich(raw.rationale ?? raw.explanation) || null,
    difficulty,
    domain,
    skill: raw.skill_desc ? String(raw.skill_desc).trim() : raw.skill ? String(raw.skill).trim() : null,
    section: 'math',
    answer_format: 'mcq',
    accepted_answers: null,
    has_visual: hasVisual,
  };
}

/**
 * Render the declarative figures on a *Reading & Writing* record with the shared
 * math engines. A `graph` spec becomes an inline `<svg>` shown beside the
 * question (via <QuestionFigure> → <MathHtml>); `table` specs become bare
 * `<table>` HTML placed inline in the stem/passage, which <RichText> renders.
 * Returns a problem string if any spec is malformed.
 */
function buildRwFigures(
  raw: Record<string, unknown>,
  n: number,
): { graphSvg: string | null; tables: Record<string, string> } | { problem: string } {
  try {
    // Wrap in .graph-figure (same as the math marker expansion) so the graph
    // theming CSS vars apply and it centers consistently.
    const wrap = (svg: string) => `<figure class="graph-figure">${svg}</figure>`;
    const parts: string[] = [];
    if (raw.graph) parts.push(wrap(renderGraphSvg(raw.graph)));
    if (raw.graphs && typeof raw.graphs === 'object') {
      for (const spec of Object.values(raw.graphs as Record<string, unknown>)) {
        parts.push(wrap(renderGraphSvg(spec)));
      }
    }
    const tables: Record<string, string> = {};
    if (raw.table) tables.table = renderTableHtml(raw.table, { bare: true });
    if (raw.tables && typeof raw.tables === 'object') {
      for (const [id, spec] of Object.entries(raw.tables as Record<string, unknown>)) {
        tables[id] = renderTableHtml(spec, { bare: true });
      }
    }
    return { graphSvg: parts.length ? parts.join('') : null, tables };
  } catch (e) {
    return { problem: `Question ${n}: bad figure spec — ${e instanceof Error ? e.message : 'invalid'}` };
  }
}

/** Replace `{{table}}`/`{{table:ID}}` markers in a fragment; records which ids it used. */
function placeTables(text: string, tables: Record<string, string>, used: Set<string>): string {
  if (!text) return text;
  return text.replace(/\{\{table(?::([\w-]+))?\}\}/g, (_m, id) => {
    const key = id || 'table';
    if (!tables[key]) return '';
    used.add(key);
    return tables[key];
  });
}

/** Drop any `{{graph}}`/`{{graph:ID}}` marker — R&W graphs render in the figure slot, not inline. */
function stripGraphMarkers(text: string): string {
  return text.replace(/\{\{graph(?::[\w-]+)?\}\}/g, '');
}

/**
 * Reading & Writing has no LaTeX renderer — it flows through <RichText>, whose
 * only math-ish markup is `<sub>`/`<sup>`. But AI-authored R&W text routinely
 * writes inline scientific notation with dollar delimiters (`$N_2O$`, `$x^2$`,
 * `$CO_2$`), which would otherwise show the literal dollar signs. Convert those
 * `$…$` / `$$…$$` runs into the sub/superscript tags RichText already renders.
 *
 * Currency-safe: a `$…$` pair is only treated as math when its inner text
 * actually contains a subscript/superscript (`_` or `^`). So "$5.00", "$5 and
 * $10", and prose dollar amounts are left exactly as written — they carry no
 * `_`/`^`, so they never match. (Full LaTeX like `\frac{…}{…}` isn't expressible
 * as sub/sup and is rare in R&W; author it in the Math section instead.)
 */
function convertInlineScience(text: string): string {
  if (!text || text.indexOf('$') === -1) return text;
  // Braced forms first (multi-char: `_{10}`, `^{2-}`), then the single-character
  // form LaTeX uses when unbraced (`_2` subscripts only the "2", so `N_2O` → N₂O).
  const toScript = (inner: string): string =>
    inner
      .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
      .replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>')
      .replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>')
      .replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>');
  const mathish = (s: string) => /[_^]/.test(s);
  return text
    .replace(/\$\$([^$\n]+)\$\$/g, (m, inner) => (mathish(inner) ? toScript(inner) : m))
    .replace(/\$([^$\n]+)\$/g, (m, inner) => (mathish(inner) ? toScript(inner) : m));
}

export function parseJsonBank(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { questions: [], problems: ['File is not valid JSON'] };
  }
  const arr = Array.isArray(data)
    ? data
    : ((data as { questions?: unknown[] })?.questions ?? []);
  if (!Array.isArray(arr)) return { questions: [], problems: ['JSON has no "questions" array'] };

  const questions: ParsedQuestion[] = [];
  const problems: string[] = [];

  for (const raw of arr as Record<string, unknown>[]) {
    const n = questions.length + 1;

    // Structured math format → its own mapper (raw HTML, SPR, figures). The R&W
    // branch below is untouched, so English JSON imports exactly as before.
    if (isMathRecord(raw)) {
      const mapped = mapMathJsonRecord(raw, n);
      if ('problem' in mapped) problems.push(mapped.problem);
      else questions.push(mapped);
      continue;
    }

    // Declarative figures (same engines as math): graph → inline SVG in the
    // figure slot; tables → inline <table> in the stem/passage.
    const fig =
      raw?.graph || raw?.graphs || raw?.table || raw?.tables
        ? buildRwFigures(raw, n)
        : { graphSvg: null, tables: {} };
    if ('problem' in fig) {
      problems.push(fig.problem);
      continue;
    }
    const usedTables = new Set<string>();
    let stemHtml = stripGraphMarkers(
      placeTables(String(raw?.question_text ?? raw?.question ?? raw?.stem ?? ''), fig.tables, usedTables),
    );
    let passageHtml = stripGraphMarkers(
      placeTables(String(raw?.passage ?? raw?.stimulus ?? ''), fig.tables, usedTables),
    );
    // A default table the author never placed with a marker goes into the
    // stimulus if there is one, else onto the stem.
    if (fig.tables.table && !usedTables.has('table')) {
      if (passageHtml.trim()) passageHtml += '\n' + fig.tables.table;
      else stemHtml += '\n' + fig.tables.table;
      usedTables.add('table');
    }

    const question_text = convertInlineScience(normalizeField(stemHtml));
    const passage = convertInlineScience(normalizeField(passageHtml));
    const options = coerceJsonOptions(raw?.options ?? raw?.choices).map((o) => ({
      ...o,
      text: convertInlineScience(o.text),
    }));
    const correct = (String(raw?.correct_answer ?? raw?.answer ?? '')
      .toUpperCase()
      .match(/[A-D]/) ?? [''])[0];

    if (!question_text) {
      problems.push(`Question ${n}: missing question_text`);
      continue;
    }
    if (options.length !== 4 || options.some((o) => !o.text)) {
      problems.push(`Question ${n}: needs four non-empty options`);
      continue;
    }
    if (!LETTERS.includes(correct as ParsedOption['letter'])) {
      problems.push(`Question ${n}: missing or invalid correct answer`);
      continue;
    }
    if (!options.some((o) => o.letter === correct && o.text)) {
      problems.push(`Question ${n}: answer ${correct} has no matching option`);
      continue;
    }

    const diff = String(raw?.difficulty ?? '').toLowerCase();
    questions.push({
      external_id: String(raw?.external_id ?? `j${n}`),
      position: n,
      passage: passage || null,
      question_text,
      options,
      correct_answer: correct as ParsedOption['letter'],
      explanation: convertInlineScience(normalizeField(String(raw?.explanation ?? raw?.rationale ?? ''))) || null,
      difficulty: (['easy', 'medium', 'hard'].includes(diff) ? diff : null) as QuestionDifficulty | null,
      domain: raw?.domain ? normalizeDomain(String(raw.domain)) : null,
      skill: raw?.skill ? String(raw.skill).replace(/\s+/g, ' ').trim() : null,
      has_visual: Boolean(fig.graphSvg) || usedTables.size > 0,
      visual_data: fig.graphSvg,
    });
  }

  return { questions, problems };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch + optional AI fallback
// ─────────────────────────────────────────────────────────────────────────────

/** Every deterministic format handler, tried against one text layer. The
 *  labelled-field parser is listed first as the preferred, most reliable format;
 *  `parseText` still keeps whichever handler recognises the most questions. */
const TEXT_PARSERS: ((text: string) => ParseResult)[] = [
  parseLabeledFields,
  parseCollegeBoardExport,
  parseLabeledSet,
];

/**
 * Run every deterministic parser and keep the best result — the one that
 * recognised the most questions, breaking ties toward the more informative
 * problem list. New formats are added by appending to `TEXT_PARSERS`.
 */
export function parseText(text: string): ParseResult {
  const results = TEXT_PARSERS.map((p) => {
    try {
      return p(text);
    } catch {
      return { questions: [], problems: [] } as ParseResult;
    }
  });
  results.sort(
    (a, b) => b.questions.length - a.questions.length || b.problems.length - a.problems.length,
  );
  return results[0] ?? { questions: [], problems: [] };
}

/**
 * Extract a .docx as formatting-preserving text via mammoth (dynamically
 * imported). Read as HTML rather than raw text so bold/italic/underline survive,
 * then collapsed to the viewer's tag whitelist. `u => u` keeps underline runs,
 * which mammoth otherwise drops — underline is load-bearing for SAT R&W ("the
 * underlined sentence the question refers to").
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const mod = await import('mammoth');
  const mammoth = (mod.default ?? mod) as {
    convertToHtml: (
      o: { buffer: Buffer },
      opts?: { styleMap?: string[] },
    ) => Promise<{ value: string }>;
  };
  const { value } = await mammoth.convertToHtml({ buffer }, { styleMap: ['u => u'] });
  return htmlToRichText(value);
}

const OPENAI_JSON_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Last-resort structured extraction with an LLM, for a layout none of the
 * deterministic parsers recognised. Gated on `OPENAI_API_KEY`: with no key it
 * returns nothing and the caller falls back to reporting the parse problems.
 * Never throws — any failure degrades to the deterministic result.
 */
async function aiParseText(text: string): Promise<ParseResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { questions: [], problems: [] };

  // Keep the prompt within a sane token budget; these papers are short.
  const clipped = text.length > 60000 ? text.slice(0, 60000) : text;

  const system =
    'You extract SAT-style multiple-choice questions from raw document text into JSON. ' +
    'Return ONLY an object {"questions": Question[]} where each Question is ' +
    '{external_id?, passage?, question_text, options: {letter:"A"|"B"|"C"|"D", text}[], ' +
    'correct_answer:"A"|"B"|"C"|"D", explanation?, ' +
    'difficulty?:"easy"|"medium"|"hard", ' +
    'domain?:"information_and_ideas"|"craft_and_structure"|"expression_of_ideas"|"standard_english_conventions", ' +
    'skill?}. CRITICAL: "passage" is the stimulus the question is ABOUT (the reading text, or the ' +
    'sentence containing the blank); "question_text" is ONLY the actual instruction/question the ' +
    'student answers (e.g. "Which choice completes the text..." or "Based on the text, ..."). Never ' +
    'put the stimulus inside question_text, and never leave passage empty when a stimulus exists. ' +
    'Preserve the passage and stem verbatim. If a field is unknown, omit it. ' +
    'Only include questions whose correct answer is stated in the document.';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_JSON_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: clipped },
        ],
      }),
    });
    if (!res.ok) return { questions: [], problems: [] };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return { questions: [], problems: [] };
    return coerceAiQuestions(JSON.parse(raw));
  } catch {
    return { questions: [], problems: [] };
  }
}

/** Validate and normalise the LLM's JSON into ParsedQuestions, dropping bad rows. */
function coerceAiQuestions(parsed: unknown): ParseResult {
  const arr = Array.isArray(parsed)
    ? parsed
    : ((parsed as { questions?: unknown[] })?.questions ?? []);
  const questions: ParsedQuestion[] = [];
  const problems: string[] = [];

  for (const item of arr as Record<string, unknown>[]) {
    const optsRaw = Array.isArray(item.options) ? item.options : [];
    const options: ParsedOption[] = [];
    for (const o of optsRaw as Record<string, unknown>[]) {
      const letter = String(o?.letter ?? '').toUpperCase();
      if (!LETTERS.includes(letter as (typeof LETTERS)[number])) continue;
      options.push({ letter: letter as ParsedOption['letter'], text: squash(String(o?.text ?? '')) });
    }
    const correct = String(item.correct_answer ?? '').toUpperCase();
    let stem = squash(String(item.question_text ?? ''));
    if (options.length !== 4 || !LETTERS.includes(correct as (typeof LETTERS)[number]) || !stem) {
      problems.push('AI: skipped an incomplete question');
      continue;
    }
    // Guard against the model dumping the whole stimulus into the stem and
    // leaving passage empty — that renders the entire question on one bolded
    // side. Recover the passage by splitting off the trailing question sentence.
    let passage = item.passage ? squash(String(item.passage)) : null;
    if (!passage) {
      const split = splitPassageAndStem(reflow(stem));
      if (split.passage && split.stem) {
        passage = split.passage;
        stem = split.stem;
      }
    }
    const diff = String(item.difficulty ?? '').toLowerCase();
    questions.push({
      external_id: `ai${questions.length + 1}`,
      position: questions.length + 1,
      passage,
      question_text: stem,
      options,
      correct_answer: correct as ParsedQuestion['correct_answer'],
      explanation: item.explanation ? squash(String(item.explanation)) : null,
      difficulty: (['easy', 'medium', 'hard'].includes(diff) ? diff : null) as QuestionDifficulty | null,
      domain: item.domain ? normalizeDomain(String(item.domain)) : null,
      skill: item.skill ? squash(String(item.skill)) : null,
    });
  }

  return { questions, problems };
}

/** The kind of document being imported. */
export type DocumentKind = 'pdf' | 'docx' | 'json';

/**
 * Decide the document kind from a MIME type or filename. Defaults to PDF.
 */
export function detectDocumentKind(hint: string | null | undefined): DocumentKind {
  const h = (hint ?? '').toLowerCase();
  if (h.includes('json') || h.endsWith('.json')) return 'json';
  if (h.includes('word') || h.endsWith('.docx') || h.includes('officedocument.wordprocessing')) {
    return 'docx';
  }
  return 'pdf';
}

/**
 * Parse a PDF or DOCX answer document into structured questions.
 *
 * Extracts the text layer, runs every deterministic format parser, and — only
 * if none recognised anything and an OpenAI key is configured — falls back to
 * an LLM pass so an unfamiliar layout still imports.
 */
export async function parseAnswerDocument(
  buffer: Buffer,
  opts: { kind?: DocumentKind; useAi?: boolean } = {},
): Promise<ParseResult> {
  const kind = opts.kind ?? 'pdf';

  // A .json upload is already structured — parse it directly, no layout to infer
  // and no AI pass.
  if (kind === 'json') return parseJsonBank(buffer.toString('utf8'));

  const text = kind === 'docx' ? await extractDocxText(buffer) : await extractText(buffer);

  const deterministic = parseText(text);
  if (deterministic.questions.length > 0) return deterministic;

  if (opts.useAi !== false) {
    const ai = await aiParseText(text);
    if (ai.questions.length > 0) return ai;
  }
  return deterministic;
}

/**
 * Parse a PDF answer document. Kept for the seed script and existing callers;
 * `parseAnswerDocument` is the broader entry point that also handles DOCX.
 */
export async function parseAnswerPdf(buffer: Buffer): Promise<ParseResult> {
  return parseAnswerDocument(buffer, { kind: 'pdf' });
}
