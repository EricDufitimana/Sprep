/**
 * SPR (grid-in) answer reconciliation — the single source of truth for detecting
 * and repairing bad free-response answers in the math bank.
 *
 * Why this exists: a batch of manually-added SPR questions shipped with their
 * answer stored as the *integer truncation* of the real value ("1" instead of
 * "1.5", "25" instead of "25.4"). The scoring code is correct — the data was
 * wrong — so every user who typed the true answer was marked incorrect.
 *
 * Every SPR explanation states the real answer in plain text ("The correct
 * answer is 1.5."). That sentence is authoritative, so we use it to (a) detect
 * a stored answer that disagrees and (b) rebuild the accepted-answer list. The
 * ingest guard, the audit script, and the one-time DB fix all call in here so
 * the rules can never drift apart.
 */

/** Strip HTML to plain text; image tags (rendered math) become a sentinel so a
 *  half-imaged fraction can never be misread as a bare integer. */
export function stripHtml(s) {
  return String(s || '')
    .replace(/<img[^>]*>/gi, ' █ ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Numeric value of a single answer token (decimal, fraction, %, $), or null. */
export function tokenValue(tok) {
  const s = String(tok).replace(/[$,%\s]/g, '');
  const frac = /^(-?\d+)\/(-?\d+)$/.exec(s);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  if (/^-?\d*\.?\d+$/.test(s)) return Number(s);
  return null;
}

/**
 * Extract the answer stated in an explanation: the clean numeric token right
 * after "the correct answer is …". Requires the token to be bounded by a
 * period, whitespace, or the image sentinel — so a fraction whose parts are
 * images (e.g. "is <img>/<img>") yields no match rather than a wrong integer.
 */
export function statedAnswer(explanation) {
  const text = stripHtml(explanation);
  const m = text.match(
    /correct answers?\s+(?:is|are)\s+(-?\$?\d[\d,]*(?:\.\d+)?(?:\/\d+)?%?)(?=[.\s█]|$)/i,
  );
  if (!m) return null;
  const value = tokenValue(m[1]);
  return value === null ? null : { token: m[1], value };
}

/** Normalize a stored answer field to an array of string tokens. */
export function toTokenList(correctAnswer) {
  if (Array.isArray(correctAnswer)) return correctAnswer.map(String);
  if (correctAnswer === null || correctAnswer === undefined) return [];
  return [String(correctAnswer)];
}

/**
 * Compare a stored SPR answer against its explanation. Returns a verdict:
 *   { status: 'ok' }                          — stored matches the stated answer
 *   { status: 'no_stated_answer' }            — explanation has no clean number
 *   { status: 'truncated', stored, correct }  — stored is the integer truncation
 *   { status: 'mismatch', stored, correct }   — stored disagrees some other way
 *
 * 'truncated' is the high-confidence, auto-fixable case: the stated value is
 * non-integer and a stored value equals its integer part (Math.trunc), with no
 * stored value equal to the true value. 'mismatch' is surfaced for human review
 * rather than auto-corrected.
 */
export function reconcile(correctAnswer, explanation) {
  const stored = toTokenList(correctAnswer);
  const stated = statedAnswer(explanation);
  if (!stated) return { status: 'no_stated_answer', stored };

  const storedValues = stored.map(tokenValue).filter((v) => v !== null);
  const hasExact = storedValues.some((v) => Math.abs(v - stated.value) < 1e-9);
  if (hasExact) return { status: 'ok', stored };

  // Known false positive: many explanations render a fraction answer as images
  // ("the correct answer is <img>a</img>/<img>b</img>"), so the extractor can
  // only see the numerator `a`. If a stored fraction has that exact numerator,
  // the stored answer is fine and we're just looking at a half-imaged fraction.
  const statedIsInteger = Math.abs(stated.value % 1) < 1e-9;
  if (statedIsInteger) {
    const numeratorMatch = stored.some((t) => {
      const f = /^(-?\d+)\/(-?\d+)$/.exec(String(t).replace(/[$,%\s]/g, ''));
      return f && Number(f[1]) === stated.value;
    });
    if (numeratorMatch) return { status: 'ok', stored };
  }

  const isNonInteger = Math.abs(stated.value % 1) > 1e-9;
  const matchesTruncation = storedValues.some(
    (v) => Math.abs(v - Math.trunc(stated.value)) < 1e-9,
  );
  const kind = isNonInteger && matchesTruncation ? 'truncated' : 'mismatch';
  return { status: kind, stored, correct: stated.token, correctValue: stated.value };
}

/** Greatest common divisor (positive) for building a reduced fraction form. */
function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/**
 * Build the accepted-answer list for a corrected value, mirroring how the SAT
 * lists grid-in answers: the terminating decimal plus its reduced fraction form
 * (only when the fraction is exact and not a whole number). The grader compares
 * numerically, so the decimal alone already grades right — the fraction is for
 * display parity with the official "X and a/b are ways to enter" note.
 */
export function buildAcceptedAnswers(decimalToken) {
  const value = tokenValue(decimalToken);
  const forms = [String(decimalToken)];
  if (value !== null && Number.isFinite(value) && !Number.isInteger(value)) {
    const decimals = (String(decimalToken).split('.')[1] || '').length;
    if (decimals > 0 && decimals <= 6) {
      const denom = 10 ** decimals;
      const numer = Math.round(value * denom);
      const g = gcd(numer, denom);
      const rn = numer / g;
      const rd = denom / g;
      if (rd !== 1) forms.push(`${rn}/${rd}`);
    }
  }
  return forms;
}
