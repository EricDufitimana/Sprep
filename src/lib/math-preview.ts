/**
 * Turn a math question's rich HTML into a short readable plain-text preview, for
 * list rows and truncated cells where full <MathHtml> rendering is overkill.
 *
 * MathML carries a spoken-form `alttext` ("StartFraction 1 Over 2 EndFraction"),
 * which is the most readable one-line form available, so each <math> collapses
 * to its alttext. Figures and tables collapse to a bracketed marker. This is
 * preview-only — the taker and review surfaces render the real HTML.
 */
export function mathPreview(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Each <math alttext="…">…</math> → its spoken form.
  s = s.replace(/<math\b[^>]*?\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, ' $1 ');
  // A <math> with no alttext still shouldn't leak tag soup.
  s = s.replace(/<math\b[^>]*>[\s\S]*?<\/math>/gi, ' [expression] ');
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' [figure] ');
  s = s.replace(/<img\b[^>]*>/gi, ' [figure] ');
  s = s.replace(/<table\b[\s\S]*?<\/table>/gi, ' [table] ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
    '&nbsp;': ' ', '&minus;': '−', '&times;': '×', '&le;': '≤', '&ge;': '≥',
    '&deg;': '°', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  };
  return s
    .replace(/&[a-zA-Z]+;/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; }
    });
}
