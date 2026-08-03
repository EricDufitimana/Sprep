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
  return html
    // Drop <script>/<style> and their contents outright.
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    // Drop inline event handlers: on…="…" / on…='…' / on…=bare.
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralise javascript: in href / src / xlink:href.
    .replace(/((?:xlink:)?(?:href|src))\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}
