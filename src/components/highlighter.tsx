'use client';

import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Text highlighting for any answering surface (question bank, timed tests, redo).
 *
 * The user picks a colour and drags over passage/question text to highlight it,
 * Bluebook-style. Highlights are stored per question as character-offset ranges
 * (into the container's plain text) in localStorage, so they survive refreshes
 * and reappear whenever that question is shown again — in any surface.
 *
 * Applying a highlight mutates the DOM directly (wrapping the range in a
 * `<mark>`), so the *content it decorates must be memoised* by the caller (keyed
 * on the question id). That keeps React from reconciling the subtree away on the
 * frequent unrelated re-renders these screens do (timers, answer picks), while
 * this module re-applies from storage whenever the question itself changes.
 */

export const HIGHLIGHT_COLORS = [
  { key: 'yellow', label: 'Yellow', value: '#FBE68A' },
  { key: 'green', label: 'Green', value: '#BBF0C9' },
  { key: 'blue', label: 'Blue', value: '#BBDDFB' },
  { key: 'pink', label: 'Pink', value: '#F8CBE0' },
  { key: 'orange', label: 'Orange', value: '#FBD7A5' },
] as const;

export type HighlightColorKey = (typeof HIGHLIGHT_COLORS)[number]['key'];
/** The active tool: a colour to paint, `erase` to remove, or `null` for off. */
export type HighlightTool = HighlightColorKey | 'erase' | null;

interface HRange {
  start: number;
  end: number;
  color: string;
}

function load(key: string): HRange[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as HRange[]) : [];
  } catch {
    return [];
  }
}
function save(key: string, ranges: HRange[]) {
  try {
    if (ranges.length) localStorage.setItem(key, JSON.stringify(ranges));
    else localStorage.removeItem(key);
  } catch {
    /* storage disabled — highlights just won't persist */
  }
}

/** Character offset of a (node, offset) selection boundary within `root`. */
function offsetOf(root: Node, node: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return count + nodeOffset;
    count += (n.textContent ?? '').length;
  }
  return count;
}

/** Strip every highlight `<mark>` back to plain text. */
function unwrap(root: HTMLElement) {
  const marks = root.querySelectorAll('mark[data-hl]');
  // Never touch the DOM when there's nothing to undo — normalising React-managed
  // text nodes when no highlights exist is what corrupts navigation.
  if (marks.length === 0) return;
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  root.normalize();
}

/** Wrap the char range [start,end) across `root`'s text nodes in coloured marks. */
function wrapRange(root: HTMLElement, start: number, end: number, color: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) texts.push(n as Text);

  let pos = 0;
  for (const t of texts) {
    const len = (t.textContent ?? '').length;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    pos = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(0, start - nodeStart);
    const to = Math.min(len, end - nodeStart);
    if (to <= from) continue;
    const range = document.createRange();
    range.setStart(t, from);
    range.setEnd(t, to);
    const mark = document.createElement('mark');
    mark.setAttribute('data-hl', '1');
    mark.style.backgroundColor = color;
    mark.style.color = 'inherit';
    mark.style.borderRadius = '2px';
    // Wrapping a range inside a single text node can't cross element bounds, so
    // surroundContents is safe here; guard anyway.
    try {
      range.surroundContents(mark);
    } catch {
      /* skip a range we can't cleanly wrap */
    }
  }
}

function applyAll(root: HTMLElement, ranges: HRange[]) {
  unwrap(root);
  for (const r of ranges) wrapRange(root, r.start, r.end, r.color);
}

/**
 * Wire one highlightable region. Attach `ref` to the container and `onMouseUp`
 * to it; render *memoised* content inside. `tool` is the currently-selected
 * colour/eraser (or null).
 */
export function useHighlighter(storageKey: string, tool: HighlightTool) {
  const ref = useRef<HTMLDivElement | null>(null);
  const ranges = useRef<HRange[]>([]);

  // Load + paint whenever the question (storageKey) changes.
  useEffect(() => {
    ranges.current = load(storageKey);
    if (ref.current) applyAll(ref.current, ranges.current);
  }, [storageKey]);

  const onMouseUp = useCallback(() => {
    const root = ref.current;
    if (!tool || !root) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;

    let start = offsetOf(root, range.startContainer, range.startOffset);
    let end = offsetOf(root, range.endContainer, range.endOffset);
    if (start > end) [start, end] = [end, start];
    if (start === end) return;

    // Drop any existing highlight overlapping the new selection, then (unless
    // erasing) add the new one — so re-painting a spot just recolours it.
    ranges.current = ranges.current.filter((r) => r.end <= start || r.start >= end);
    if (tool !== 'erase') {
      const value = HIGHLIGHT_COLORS.find((c) => c.key === tool)?.value ?? HIGHLIGHT_COLORS[0].value;
      ranges.current.push({ start, end, color: value });
    }
    save(storageKey, ranges.current);
    applyAll(root, ranges.current);
    sel.removeAllRanges();
  }, [tool, storageKey]);

  const clear = useCallback(() => {
    ranges.current = [];
    save(storageKey, []);
    if (ref.current) applyAll(ref.current, []);
  }, [storageKey]);

  return { ref, onMouseUp, clear };
}

/**
 * The colour swatches + eraser + clear controls. Style-neutral (app ink tokens),
 * so it drops into either taker's own popover/menu.
 */
export function HighlightSwatches({
  tool,
  onTool,
  onClear,
  className,
}: {
  tool: HighlightTool;
  onTool: (t: HighlightTool) => void;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {HIGHLIGHT_COLORS.map((c) => {
        const on = tool === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onTool(on ? null : c.key)}
            title={c.label}
            aria-label={`Highlight ${c.label}`}
            aria-pressed={on}
            className={cn(
              'h-6 w-6 rounded-full ring-offset-1 transition',
              on ? 'ring-2 ring-ink-900' : 'ring-1 ring-black/15 hover:ring-black/35',
            )}
            style={{ backgroundColor: c.value }}
          />
        );
      })}
      <span className="mx-0.5 h-5 w-px bg-black/10" />
      <button
        type="button"
        onClick={() => onTool(tool === 'erase' ? null : 'erase')}
        title="Erase highlights"
        aria-pressed={tool === 'erase'}
        className={cn(
          'flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium transition',
          tool === 'erase' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-black/5',
        )}
      >
        Erase
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Clear all highlights on this question"
        className="flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-ink-500 hover:bg-black/5"
      >
        Clear
      </button>
    </div>
  );
}
