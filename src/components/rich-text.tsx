import { type ReactNode } from 'react';

/**
 * Render SAT question text that carries a small whitelist of HTML formatting.
 * The ingest pipeline (`scripts/ingest-json-bank.mjs`) preserves these markers
 * and flattens everything else to clean text:
 *
 *   <strong>, <b>   bold
 *   <em>, <i>       italic — titles of works, genus names
 *   <u>             underline — the "underlined sentence" a question refers to
 *   <sub>           subscript — chemical formulae (H<sub>2</sub>O)
 *   <sup>           superscript — units and exponents (cm<sup>2</sup>)
 *   <br>            explicit line break
 *   "\n"            line break — paragraph/list boundaries are stored as newlines
 *   "• "            list bullets (added at ingest for <li> items)
 *
 * Parsing is a small tokenizer over that whitelist — no `dangerouslySetInnerHTML`.
 * Newlines become real <br/> elements here, so line breaks render on ANY surface
 * regardless of its `white-space` CSS. Any other "<" run is emitted as literal,
 * escaped text, so this is XSS-safe.
 */
export function RichText({ children }: { children: string | null | undefined }) {
  return <>{parseRich(children ?? '')}</>;
}

/** Void + container tags we understand. `\s*\/?` tolerates `<br>`, `<br/>`, `<br />`. */
const TAG_RE = /<(\/?)(strong|b|em|i|u|sub|sup|br)\s*\/?>/gi;

const WRAP: Record<string, (key: number, kids: ReactNode[]) => ReactNode> = {
  strong: (key, kids) => <strong key={key} className="font-bold">{kids}</strong>,
  b: (key, kids) => <strong key={key} className="font-bold">{kids}</strong>,
  em: (key, kids) => <em key={key}>{kids}</em>,
  i: (key, kids) => <em key={key}>{kids}</em>,
  u: (key, kids) => <u key={key}>{kids}</u>,
  sub: (key, kids) => <sub key={key}>{kids}</sub>,
  sup: (key, kids) => <sup key={key}>{kids}</sup>,
};

type Frame = { tag: string; children: ReactNode[] };

function parseRich(text: string): ReactNode[] {
  if (!text) return [];
  if (!text.includes('<') && !text.includes('\n')) return [text];

  const root: Frame = { tag: '', children: [] };
  const stack: Frame[] = [root];
  let key = 0;
  const nextKey = () => key++;

  // Emit a run of plain text, turning each embedded "\n" into a <br/>.
  const emitText = (s: string) => {
    if (!s) return;
    const top = stack[stack.length - 1];
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

    const tag = m[2].toLowerCase();
    if (tag === 'br') {
      stack[stack.length - 1].children.push(<br key={nextKey()} />);
      continue;
    }
    if (m[1] !== '/') {
      stack.push({ tag, children: [] });
    } else if (stack.length > 1 && stack[stack.length - 1].tag === tag) {
      const frame = stack.pop()!;
      stack[stack.length - 1].children.push(WRAP[frame.tag](nextKey(), frame.children));
    } else {
      // Unbalanced close tag — keep it literal rather than dropping content.
      stack[stack.length - 1].children.push(m[0]);
    }
  }

  emitText(text.slice(last));
  // Flush any tags left open by malformed input, innermost first.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack[stack.length - 1].children.push(WRAP[frame.tag](nextKey(), frame.children));
  }
  return root.children;
}
