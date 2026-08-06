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

export type QuestionDomain =
  | 'information_and_ideas'
  | 'craft_and_structure'
  | 'expression_of_ideas'
  | 'standard_english_conventions';

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
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation: string | null;
  difficulty: QuestionDifficulty | null;
  domain: QuestionDomain | null;
  skill: string | null;
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
function parseCollegeBoardExport(text: string): ParseResult {
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

function parseLabeledSet(text: string): ParseResult {
  const cleaned = stripPageFurniture(text);

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
// Dispatch + optional AI fallback
// ─────────────────────────────────────────────────────────────────────────────

/** Every deterministic format handler, tried against one text layer. */
const TEXT_PARSERS: ((text: string) => ParseResult)[] = [
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

/** Extract the text layer from a .docx via mammoth (dynamically imported). */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const mod = await import('mammoth');
  const mammoth = (mod.default ?? mod) as {
    extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
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
    'skill?}. Preserve the passage and stem verbatim. If a field is unknown, omit it. ' +
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
    const stem = squash(String(item.question_text ?? ''));
    if (options.length !== 4 || !LETTERS.includes(correct as (typeof LETTERS)[number]) || !stem) {
      problems.push('AI: skipped an incomplete question');
      continue;
    }
    const diff = String(item.difficulty ?? '').toLowerCase();
    questions.push({
      external_id: `ai${questions.length + 1}`,
      position: questions.length + 1,
      passage: item.passage ? squash(String(item.passage)) : null,
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
export type DocumentKind = 'pdf' | 'docx';

/**
 * Decide the document kind from a MIME type or filename. Defaults to PDF.
 */
export function detectDocumentKind(hint: string | null | undefined): DocumentKind {
  const h = (hint ?? '').toLowerCase();
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
