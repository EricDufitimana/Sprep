import { isValidElement, type ReactNode } from 'react';

/**
 * Render SAT question text that carries a small whitelist of HTML formatting.
 * The ingest pipeline (`scripts/ingest-json-bank.mjs`) and the labelled-doc /
 * JSON parsers preserve these markers and flatten everything else to clean text:
 *
 *   <strong>, <b>   bold
 *   <em>, <i>       italic — titles of works, genus names
 *   <u>             underline — the "underlined sentence" a question refers to
 *   <sub>           subscript — chemical formulae (H<sub>2</sub>O)
 *   <sup>           superscript — units and exponents (cm<sup>2</sup>)
 *   <br>            explicit line break
 *   <img src=…>     inline figure — only http(s) or data:image sources render
 *   <table> …       a data table: <caption>, <thead>/<tbody>/<tfoot>, <tr>,
 *                   <th>, <td> are all understood and rendered as a real table
 *   "\n"            line break — paragraph/list boundaries are stored as newlines
 *   "• "            list bullets (added at ingest for <li> items)
 *
 * Parsing is a small tokenizer over that whitelist — no `dangerouslySetInnerHTML`.
 * Text runs are always emitted as React children (so they're escaped), tags
 * outside the whitelist are dropped, and image sources are restricted, so this
 * stays XSS-safe.
 */
export function RichText({ children }: { children: string | null | undefined }) {
  return <>{parseRich(children ?? '')}</>;
}

/** Any tag: group 1 = leading slash, 2 = name, 3 = attributes, 4 = self-close slash. */
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/g;

/** Container tags we wrap; every other tag name is dropped (its text is kept). */
const WRAP: Record<string, (key: number, kids: ReactNode[]) => ReactNode> = {
  strong: (key, kids) => <strong key={key} className="font-bold">{kids}</strong>,
  b: (key, kids) => <strong key={key} className="font-bold">{kids}</strong>,
  em: (key, kids) => <em key={key}>{kids}</em>,
  i: (key, kids) => <em key={key}>{kids}</em>,
  u: (key, kids) => <u key={key}>{kids}</u>,
  sub: (key, kids) => <sub key={key}>{kids}</sub>,
  sup: (key, kids) => <sup key={key}>{kids}</sup>,
  // Tables. The stray whitespace between structural tags is suppressed (see
  // emitText), so rows/cells don't collect invalid text-node children.
  table: (key, kids) => (
    <div key={key} className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-small text-ink-700">
        {tableChildren(kids)}
      </table>
    </div>
  ),
  caption: (key, kids) => (
    <caption key={key} className="caption-top mb-2 text-left text-small font-medium text-ink-700">
      {kids}
    </caption>
  ),
  thead: (key, kids) => <thead key={key}>{kids}</thead>,
  tbody: (key, kids) => <tbody key={key}>{kids}</tbody>,
  tfoot: (key, kids) => <tfoot key={key}>{kids}</tfoot>,
  tr: (key, kids) => <tr key={key}>{kids}</tr>,
  th: (key, kids) => (
    <th key={key} className="border border-line bg-sunken/60 px-3 py-1.5 text-left font-semibold text-ink-900">
      {kids}
    </th>
  ),
  td: (key, kids) => (
    <td key={key} className="border border-line px-3 py-1.5 align-top">{kids}</td>
  ),
};

/** Tags whose direct children are structural — any text between them is layout
 *  whitespace, not content, and must not become a text node. */
const STRUCTURAL = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);

/** Void tags: no children, no stack frame. */
const VOID = new Set(['br', 'img']);

/**
 * Order a <table>'s children into valid DOM: caption first, then row-group
 * sections, and any loose <tr> (a table written without <tbody>) wrapped in one
 * so React doesn't warn. Stray text between tags is ignored.
 */
function tableChildren(kids: ReactNode[]): ReactNode[] {
  const caption: ReactNode[] = [];
  const sections: ReactNode[] = [];
  const looseRows: ReactNode[] = [];
  for (const k of kids) {
    if (!isValidElement(k)) continue;
    const t = k.type;
    if (t === 'caption') caption.push(k);
    else if (t === 'thead' || t === 'tbody' || t === 'tfoot' || t === 'colgroup') sections.push(k);
    else if (t === 'tr') looseRows.push(k);
  }
  const rows = looseRows.length ? [<tbody key="loose-body">{looseRows}</tbody>] : [];
  return [...caption, ...sections, ...rows];
}

/** Pull one attribute's value out of a tag's attribute string. */
function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

/** Only real, fetchable image sources render — http(s) or an inline data:image.
 *  A `blob:` handle (e.g. from another site) points at nothing here, so it's dropped. */
function safeSrc(src: string | null): string | null {
  if (!src) return null;
  return /^(https?:\/\/|data:image\/)/i.test(src.trim()) ? src.trim() : null;
}

type Frame = { tag: string; children: ReactNode[] };

function isBr(node: ReactNode): boolean {
  return isValidElement(node) && node.type === 'br';
}

function parseRich(text: string): ReactNode[] {
  if (!text) return [];
  if (!text.includes('<') && !text.includes('\n')) return [text];

  const root: Frame = { tag: '', children: [] };
  const stack: Frame[] = [root];
  let key = 0;
  const nextKey = () => key++;

  // After a block element (a table) we swallow the immediately following layout
  // newlines so the block doesn't get flanked by empty lines.
  let trimNextLeadingSpace = false;

  // Emit a run of plain text, turning each embedded "\n" into a <br/>. Inside a
  // table's structure, text is layout whitespace and is dropped entirely.
  const emitText = (raw: string) => {
    if (!raw) return;
    const top = stack[stack.length - 1];
    if (STRUCTURAL.has(top.tag)) return;
    let s = raw;
    if (trimNextLeadingSpace) {
      s = s.replace(/^\s+/, '');
      trimNextLeadingSpace = false;
      if (!s) return;
    }
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) top.children.push(<br key={nextKey()} />);
      if (lines[i]) top.children.push(lines[i]);
    }
  };

  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    emitText(text.slice(last, m.index));
    last = TAG_RE.lastIndex;

    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    const selfClose = m[4] === '/';

    if (name === 'br') {
      stack[stack.length - 1].children.push(<br key={nextKey()} />);
      continue;
    }
    if (name === 'img') {
      if (!closing) {
        const src = safeSrc(attr(attrs, 'src'));
        if (src) {
          stack[stack.length - 1].children.push(
            <img
              key={nextKey()}
              src={src}
              alt={attr(attrs, 'alt') ?? ''}
              className="my-2 block h-auto max-w-full rounded"
            />,
          );
        }
      }
      continue;
    }

    const wrap = WRAP[name];
    if (!wrap) continue; // tag outside the whitelist — drop it, keep its text

    if (!closing) {
      if (selfClose) {
        stack[stack.length - 1].children.push(wrap(nextKey(), []));
      } else {
        stack.push({ tag: name, children: [] });
      }
    } else if (stack.length > 1 && stack[stack.length - 1].tag === name) {
      const frame = stack.pop()!;
      const parent = stack[stack.length - 1];
      if (name === 'table') {
        // Drop a blank line sitting right before the table, and swallow the one
        // right after, so the block sits flush against its surrounding prose.
        while (parent.children.length && isBr(parent.children[parent.children.length - 1])) {
          parent.children.pop();
        }
        parent.children.push(wrap(nextKey(), frame.children));
        trimNextLeadingSpace = true;
      } else {
        parent.children.push(wrap(nextKey(), frame.children));
      }
    }
    // An unbalanced close tag is simply ignored.
  }

  emitText(text.slice(last));
  // Flush any tags left open by malformed input, innermost first.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack[stack.length - 1].children.push(WRAP[frame.tag](nextKey(), frame.children));
  }
  return root.children;
}
