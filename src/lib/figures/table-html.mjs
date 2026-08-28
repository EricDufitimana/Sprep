/**
 * Turn a compact, declarative **table spec** (plain JSON) into a clean HTML
 * `<table>` — the table counterpart to the graph engine (graph-svg.mjs).
 *
 * Authoring an HTML table by hand inside a JSON string is miserable and easy to
 * get wrong. Instead the author writes:
 *
 *   { "headers": ["x", "y"], "rows": [["1","2"], ["3","4"]] }
 *
 * and this renders the `<table>` that <MathHtml> already styles (see the
 * `.math-html table` rules in globals.css) and that MathJax typesets — so **cells
 * may contain LaTeX** (`\(\frac{1}{2}\)`), just like the stem.
 *
 * Placement works exactly like graphs: put `{{table}}` (or `{{table:ID}}` when a
 * record ships several via a `tables` map) where the table should appear, or omit
 * the marker for a single table and it's appended.
 *
 * Cells are inserted verbatim (not HTML-escaped) so LaTeX and light inline markup
 * pass through — consistent with how math stems are stored raw and sanitized once
 * at render time by <MathHtml>. Wrap comparisons like `x < 5` in LaTeX so the
 * bare `<` never looks like a tag.
 */

import { expandFigureMarkers } from './figure-markers.mjs';

/** A column alignment → the CSS text-align it maps to (default: center, matching the corpus). */
const ALIGN = { left: 'left', center: 'center', right: 'right' };

/** style="text-align:…" for a column index, or '' when the default (center) applies. */
function alignAttr(align, i) {
  const a = Array.isArray(align) ? ALIGN[align[i]] : undefined;
  return a && a !== 'center' ? ` style="text-align:${a}"` : '';
}

/**
 * Render a table spec to an HTML `<table>` string.
 *
 * Spec:
 *   {
 *     "headers": string[],            // column headers (optional; omit for a headless grid)
 *     "rows":    string[][],          // each inner array is one row of cells
 *     "align":   ("left"|"center"|"right")[],  // optional, per column
 *     "rowHeaders": boolean,          // optional: render each row's first cell as a <th scope="row">
 *     "caption": string               // optional caption under the table
 *   }
 *
 * Throws on a malformed spec so a bad table is caught at ingest, never shipped blank.
 *
 * @param {*} spec
 * @param {{ bare?: boolean }} [opts]
 * @param {boolean} [opts.bare]  Emit a plain `<table>` with the caption INSIDE it
 *   (`<caption>`), and no `<figure>` wrapper. This is what the Reading & Writing
 *   `<RichText>` renderer understands — its whitelist has `<table>`/`<caption>`
 *   but not `<figure>`/`<figcaption>`. The math `<MathHtml>` path uses the default
 *   (figure-wrapped) form.
 */
export function renderTableHtml(spec, opts = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('table spec must be an object');
  const rows = spec.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('table spec needs a non-empty "rows" array');
  const headers = Array.isArray(spec.headers) ? spec.headers : null;
  const align = spec.align;
  const rowHeaders = Boolean(spec.rowHeaders);

  const thead = headers
    ? `<thead><tr>${headers
        .map((h, i) => `<th scope="col"${alignAttr(align, i)}>${h ?? ''}</th>`)
        .join('')}</tr></thead>`
    : '';

  const tbody =
    '<tbody>' +
    rows
      .map((row) => {
        const cells = (Array.isArray(row) ? row : [row]).map((cell, i) => {
          const val = cell ?? '';
          // First cell as a row header when asked (e.g. a labeled data table).
          if (rowHeaders && i === 0) return `<th scope="row"${alignAttr(align, i)}>${val}</th>`;
          return `<td${alignAttr(align, i)}>${val}</td>`;
        });
        return `<tr>${cells.join('')}</tr>`;
      })
      .join('') +
    '</tbody>';

  // Bare form (RichText): caption goes inside the <table>; no <figure> wrapper.
  if (opts.bare) {
    const cap = spec.caption ? `<caption>${spec.caption}</caption>` : '';
    return `<table>${cap}${thead}${tbody}</table>`;
  }

  const caption = spec.caption
    ? `<figcaption class="table-caption">${spec.caption}</figcaption>`
    : '';

  return `<figure class="table-figure"><table>${thead}${tbody}</table>${caption}</figure>`;
}

/**
 * Expand `{{table}}` / `{{table:ID}}` markers in a fragment with pre-rendered
 * table HTML. The rendered table already carries its own <figure>, so no extra
 * wrapper is added. See expandGraphMarkers for the graph twin.
 *
 * @param {string} html
 * @param {Record<string,string>} htmlById  id → table html (default table is id "table")
 */
export function expandTableMarkers(html, htmlById) {
  return expandFigureMarkers(html, 'table', htmlById, (t) => t);
}
