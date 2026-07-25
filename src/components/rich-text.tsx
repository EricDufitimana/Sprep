import { type ReactNode } from 'react';

/**
 * Render SAT question text that carries a small whitelist of inline formatting
 * tags. The ingest pipeline (`scripts/ingest-json-bank.mjs`) preserves exactly
 * these markers and strips everything else:
 *
 *   <u>      underline — the phrase a "supports the underlined sentence"
 *            question refers to; without it those questions are unanswerable
 *   <em>     italic — titles of works (e.g. novels), genus names
 *   <strong> bold
 *   <sub>    subscript — chemical formulae (H<sub>2</sub>O)
 *   <sup>    superscript — units and exponents (cm<sup>2</sup>)
 *
 * Parsing is a small tokenizer over that whitelist — no `dangerouslySetInnerHTML`.
 * Any other "<" run is emitted as literal text, so this is XSS-safe even though
 * the ingest already guarantees only whitelisted tags reach the column.
 *
 * Newlines in the source string are preserved as text; put `whitespace-pre-line`
 * on the surrounding element to render multi-paragraph passages as written.
 */
export function RichText({ children }: { children: string | null | undefined }) {
  return <>{parseInline(children ?? '')}</>;
}

const TAG_RE = /<(\/?)(u|em|strong|sub|sup)>/gi;

const WRAP: Record<string, (key: number, kids: ReactNode[]) => ReactNode> = {
  u: (key, kids) => <u key={key}>{kids}</u>,
  em: (key, kids) => <em key={key}>{kids}</em>,
  strong: (key, kids) => (
    <strong key={key} className="font-semibold">
      {kids}
    </strong>
  ),
  sub: (key, kids) => <sub key={key}>{kids}</sub>,
  sup: (key, kids) => <sup key={key}>{kids}</sup>,
};

type Frame = { tag: string; children: ReactNode[] };

function parseInline(text: string): ReactNode[] {
  if (!text.includes('<')) return [text];

  const root: Frame = { tag: '', children: [] };
  const stack: Frame[] = [root];
  let key = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((m = TAG_RE.exec(text))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push(text.slice(last, m.index));
    last = TAG_RE.lastIndex;

    const tag = m[2].toLowerCase();
    if (m[1] !== '/') {
      stack.push({ tag, children: [] });
    } else if (stack.length > 1 && stack[stack.length - 1].tag === tag) {
      const frame = stack.pop()!;
      stack[stack.length - 1].children.push(WRAP[frame.tag](key++, frame.children));
    } else {
      // Unbalanced close tag — keep it literal rather than dropping content.
      top.children.push(m[0]);
    }
  }

  if (last < text.length) stack[stack.length - 1].children.push(text.slice(last));
  // Flush any tags left open by malformed input, innermost first.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack[stack.length - 1].children.push(WRAP[frame.tag](key++, frame.children));
  }
  return root.children;
}
