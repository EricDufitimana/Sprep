/**
 * Parse a College Board "Answers" export PDF into structured questions.
 *
 * Deliberately not marked `server-only`: it's a pure function over a Buffer
 * with no secrets, and the seeding script runs it under plain Node. Keep it
 * out of client components anyway — it pulls in pdf-parse.
 *
 * These exports are self-describing: every question carries its own ID,
 * passage, stem, four options, correct answer, rationale, domain, skill, and
 * difficulty. That makes them deterministically parseable, so a bank built
 * from one of these files needs no AI extraction and no separate answer key —
 * the ground truth is already inside the document.
 *
 * Block shape in the extracted text layer:
 *
 *   Question ID <id>
 *   ID: <id>
 *   <passage…>
 *   <stem>
 *   A. <option>  B. <option>  C. <option>  D. <option>
 *   ID: <id> Answer
 *   Correct Answer: <A-D>
 *   Rationale
 *   <rationale…>
 *   Question Difficulty: <Easy|Medium|Hard>
 *   Domain\n<domain>\nSkill\n<skill>\nDifficulty
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
  return s.replace(/([A-Za-z\u00C0-\u024F]{2,})\s{2,}([A-Za-z\u00C0-\u024F]{1,2})\b/g, '$1$2');
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

/** Parse a whole answer-export PDF. */
export async function parseAnswerPdf(buffer: Buffer): Promise<ParseResult> {
  const text = await extractText(buffer);

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
