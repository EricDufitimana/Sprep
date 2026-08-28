/**
 * Shared marker-expansion used by both the graph engine (graph-svg.mjs) and the
 * table engine (table-html.mjs).
 *
 * A rich-HTML fragment (stem, choice body, rationale) can contain placeholders
 * like `{{graph}}` / `{{graph:opt_a}}` or `{{table}}` / `{{table:data}}`. Each is
 * replaced with the pre-rendered HTML for that id. The default id equals the
 * marker `kind` itself (so a lone `{{graph}}` maps to id "graph"), and if a
 * default figure is never placed by a marker it is appended to the end — this is
 * what lets an author omit the marker for a single-figure question.
 */

/**
 * @param {string} html                the fragment to expand
 * @param {'graph'|'table'} kind       marker keyword
 * @param {Record<string,string>} byId id → pre-rendered HTML (default id === kind)
 * @param {(inner:string)=>string} wrap wrap each placement (e.g. in a <figure>)
 */
export function expandFigureMarkers(html, kind, byId, wrap) {
  let out = html ?? '';
  if (!byId || Object.keys(byId).length === 0) return out;
  const used = new Set();
  const re = new RegExp(`\\{\\{${kind}(?::([\\w-]+))?\\}\\}`, 'g');
  out = out.replace(re, (_m, id) => {
    const key = id || kind;
    const inner = byId[key];
    if (!inner) throw new Error(`${kind} marker {{${kind}${id ? ':' + id : ''}}} has no matching spec`);
    used.add(key);
    return wrap(inner);
  });
  // Auto-append the default figure if the author never placed its marker.
  if (byId[kind] && !used.has(kind)) out += wrap(byId[kind]);
  return out;
}
