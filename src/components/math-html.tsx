'use client';

import { useMemo, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useTypesetMath } from '@/lib/mathjax';

/**
 * Render a math question's rich HTML — the one component that handles every
 * math requirement in the corpus:
 *
 *   • MathML (<math>…</math>)      typeset to SVG by MathJax (crisp, consistent)
 *   • LaTeX (\(…\), \[…\])         typeset to SVG by MathJax
 *   • inline SVG figures           graphs, number lines, diagrams
 *   • base64 <img> (data: URIs)    rasterised figures the source ships inline
 *   • <table>                      data tables, scrolled horizontally if wide
 *   • <p>/<strong>/<sup>/…         ordinary block + inline formatting
 *
 * The math JSON stores these self-contained fragments verbatim (see
 * `scripts/ingest-math-bank.mjs`), so unlike Reading & Writing — which flattens
 * to whitelisted text for <RichText> — math is rendered as HTML. The content is
 * admin-ingested College Board data, but it's still sanitized here (scripts,
 * event handlers, and javascript: URLs stripped) so a bad fragment can't run.
 *
 * Equations arrive as MathML. The markup is written to the DOM as-is (so native
 * MathML shows immediately and remains the fallback if JS is off), then MathJax
 * typesets it to SVG for rendering that's identical across every browser — see
 * `useTypesetMath` / `src/lib/mathjax.ts`.
 */
export function MathHtml({
  html,
  className,
  block = true,
}: {
  html: string | null | undefined;
  className?: string;
  /** A choice/inline context renders as a <span> with no block spacing. */
  block?: boolean;
}) {
  const clean = useMemo(() => sanitize(html ?? ''), [html]);
  // Re-typeset whenever the sanitized markup changes (question navigation, etc.).
  const ref = useTypesetMath<HTMLElement>([clean]);
  if (!clean) return null;
  // Sanitized above; native MathML/SVG need real HTML, not a text tokenizer.
  const shared = {
    className: cn('math-html', className),
    dangerouslySetInnerHTML: { __html: clean },
  };
  return block ? (
    <div ref={ref as RefObject<HTMLDivElement>} {...shared} />
  ) : (
    <span ref={ref as RefObject<HTMLSpanElement>} {...shared} />
  );
}

/**
 * Strip the executable surface from a trusted-but-rich HTML fragment. Keeps all
 * presentational markup (MathML, SVG, img[data:], tables); removes only things
 * that can run code.
 */
function sanitize(html: string): string {
  return expandMfenced(html)
    // Drop <script>/<style> and their contents outright.
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    // Drop inline event handlers: on…="…" / on…='…' / on…=bare.
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralise javascript: in href / src / xlink:href.
    .replace(/((?:xlink:)?(?:href|src))\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

/**
 * Rewrite MathML's deprecated `<mfenced>` to an explicit fenced `<mrow>`:
 *
 *   <mfenced><mi>x</mi></mfenced>  →  <mrow><mo>(</mo><mi>x</mi><mo>)</mo></mrow>
 *
 * Why: a big share of the stems wrap function arguments in `<mfenced>` (f(x)),
 * but browsers' *native* MathML (Chrome's MathML Core) dropped `<mfenced>` — so
 * before MathJax finishes typesetting, those render as "fx" with no parentheses,
 * while explanations (which use explicit `<mo>(</mo>`) look right. Expanding it
 * here makes the parentheses correct in BOTH the native fallback and MathJax,
 * with no timing gap. Honors `open`/`close`/`separators` and nests inside-out.
 */
function expandMfenced(html: string): string {
  if (html.indexOf('<mfenced') === -1) return html;
  // Innermost first: match an <mfenced> whose body contains no nested <mfenced>.
  const INNERMOST = /<mfenced\b([^>]*)>((?:(?!<mfenced\b)[\s\S])*?)<\/mfenced>/i;
  let out = html;
  for (let guard = 0; guard < 100 && INNERMOST.test(out); guard++) {
    out = out.replace(INNERMOST, (_full, attrs: string, inner: string) => {
      const open = readAttr(attrs, 'open', '(');
      const close = readAttr(attrs, 'close', ')');
      const seps = readAttr(attrs, 'separators', ',');
      const kids = splitTopLevel(inner);
      let body = '';
      kids.forEach((kid, i) => {
        if (i > 0 && seps) {
          const sep = seps[Math.min(i - 1, seps.length - 1)];
          if (sep && sep.trim()) body += `<mo>${escapeMathText(sep)}</mo>`;
        }
        body += kid;
      });
      const o = open ? `<mo>${escapeMathText(open)}</mo>` : '';
      const c = close ? `<mo>${escapeMathText(close)}</mo>` : '';
      return `<mrow>${o}${body}${c}</mrow>`;
    });
  }
  return out;
}

/** Read one attribute value out of a raw tag-attribute string; fall back to `dflt`. */
function readAttr(attrs: string, name: string, dflt: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (!m) return dflt;
  return m[2] ?? m[3] ?? '';
}

/** Escape the few characters that matter when injecting a fence char into markup. */
function escapeMathText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Split a run of MathML into its top-level element children (mfenced's arguments),
 * so separators can be placed between them. Depth-tracks tags; ignores stray text.
 */
function splitTopLevel(s: string): string[] {
  const kids: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s))) {
    const closing = m[1] === '/';
    const selfClose = m[4] === '/';
    if (selfClose) {
      if (depth === 0) kids.push(s.slice(m.index, tagRe.lastIndex));
    } else if (!closing) {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) {
        kids.push(s.slice(start, tagRe.lastIndex));
        start = -1;
      }
    }
  }
  // No element children (e.g. bare text like <mfenced>x</mfenced>) → keep as one.
  return kids.length ? kids : [s];
}
