/**
 * Self-hosted MathJax (SVG output) loader + a React hook that typesets a DOM
 * subtree. This is the reliability layer under <MathHtml>: the corpus stores
 * equations as MathML, and browsers render native MathML inconsistently
 * (spacing, stretchy brackets, roots, older Safari). MathJax typesets that same
 * MathML to crisp, identical-everywhere SVG.
 *
 * Why SVG (not CHTML): the SVG output jax carries its glyph paths inside the
 * one vendored bundle (`public/mathjax/tex-mml-svg.js`), so there are no
 * external WOFF font files to serve — it works offline and can't half-load.
 *
 * The bundle is loaded lazily on the first typeset and only once per page; a
 * single readiness promise is shared across every <MathHtml> instance.
 */

'use client';

import { useEffect, useRef, type DependencyList } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    MathJax?: any;
    /** Resolves when the MathJax bundle has finished its startup. */
    __mathjaxReady?: Promise<void>;
  }
}

/** The vendored bundle path (see public/mathjax/). Self-hosted, no CDN. */
const MATHJAX_SRC = '/mathjax/tex-mml-svg.js';

/**
 * Configure + inject MathJax exactly once, returning a promise that resolves
 * when it's ready to typeset. Safe to call from any component on any render.
 */
export function ensureMathJax(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.__mathjaxReady) return window.__mathjaxReady;

  window.__mathjaxReady = new Promise<void>((resolve) => {
    // Config must be set on window.MathJax *before* the script runs.
    window.MathJax = {
      // The corpus is MathML; also accept explicit LaTeX delimiters for any
      // AI-extracted content. Bare "$" is intentionally NOT a delimiter — it
      // would turn prices like "$5" into math.
      tex: {
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]']],
        processEscapes: true,
      },
      svg: { fontCache: 'local' },
      options: {
        enableMenu: false,
        // Don't let MathJax walk into anything we didn't mark as math.
        ignoreHtmlClass: 'mathjax-ignore',
        processHtmlClass: 'math-html',
      },
      startup: {
        // We typeset explicitly, per element, from the hook below.
        typeset: false,
        ready: () => {
          window.MathJax.startup.defaultReady();
          resolve();
        },
      },
    };

    const script = document.createElement('script');
    script.src = MATHJAX_SRC;
    script.async = true;
    // If the bundle fails to load, resolve anyway so the native MathML that's
    // already in the DOM remains the visible (graceful) fallback.
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

  return window.__mathjaxReady;
}

/**
 * Typeset the referenced element's contents whenever `deps` change. Attach the
 * returned ref to the element holding math markup.
 *
 * `typesetClear` first drops any prior MathJax state tied to the element so a
 * content change (React replacing innerHTML) doesn't leave stale SVG or grow
 * MathJax's internal math list.
 */
export function useTypesetMath<T extends HTMLElement = HTMLElement>(
  deps: DependencyList,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureMathJax().then(() => {
      const el = ref.current;
      if (cancelled || !el || !window.MathJax?.typesetPromise) return;
      try {
        window.MathJax.typesetClear?.([el]);
      } catch {
        /* no prior state — fine */
      }
      window.MathJax.typesetPromise([el]).catch(() => {
        /* a malformed fragment shouldn't break the page; native MathML stays */
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
