'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Render a math question's rich HTML — the one component that handles every
 * math requirement in the corpus:
 *
 *   • MathML (<math>…</math>)      rendered natively by the browser
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
  if (!clean) return null;
  const Tag = block ? 'div' : 'span';
  return (
    <Tag
      className={cn('math-html', className)}
      // Sanitized above; native MathML/SVG need real HTML, not a text tokenizer.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
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
