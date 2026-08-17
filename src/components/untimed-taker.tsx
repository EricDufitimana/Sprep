'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';
import { RichText } from '@/components/rich-text';
import { MathHtml } from '@/components/math-html';
import { QuestionFigure } from '@/components/question-figure';
import { DesmosCalculator } from '@/components/desmos-calculator';
import { SatReferenceSheet } from '@/components/sat-reference-sheet';
import { Icon } from '@/components/ui/icon';
import { LoadingDots } from '@/components/ui/loading-dots';
import { HighlightSwatches, useHighlighter, type HighlightTool } from '@/components/highlighter';

/**
 * Shared untimed taker: one question at a time, per-question stopwatch, and an
 * instant "Check" that reveals the answer + explanation and records the attempt.
 * Used by the Question Bank's custom sets and by "redo your misses" on a results
 * page — anywhere a set of questions is worked through untimed with feedback.
 */

type Opt = { letter: string; text: string };
export interface BuiltQuestion {
  id: string;
  external_id: string | null;
  passage: string | null;
  question_text: string;
  options: unknown;
  has_visual: boolean;
  visual_data: string | null;
  visual_url: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: string | null;
  section?: string | null;
  answer_format?: string | null;
}

/* ── Taker: split-pane exam surface, per-question timer + instant check ────── */

type QResult = { correctAnswer: string; explanation: string | null; isCorrect: boolean | null };
type QState = { selected: string | null; result: QResult | null; timeMs: number };
const EMPTY_STATE: QState = { selected: null, result: null, timeMs: 0 };

/** mm:ss from milliseconds. */
function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function UntimedTaker({
  questions,
  scopeLabel,
  onExit,
}: {
  questions: BuiltQuestion[];
  scopeLabel: string;
  onExit: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<Record<string, QState>>({});
  const [navOpen, setNavOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  // Optimistic "checking" flag: flips true the instant Check is clicked so the
  // button shows a loading indication even when the reveal resolves quickly.
  const [checking, setChecking] = useState(false);

  // Difficulty stays hidden until revealed from the "More" menu (like /tester).
  const [showDifficulty, setShowDifficulty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Answer eliminator: toggled from the "More" menu. When on, each choice shows a
  // subtle cross; clicking it strikes that choice out (click again to restore).
  // Struck letters are tracked per question.
  const [eliminating, setEliminating] = useState(false);
  const [struck, setStruck] = useState<Record<string, string[]>>({});

  // Desmos panel — Bluebook's math calculator. Open/closed is remembered, and
  // the graph itself persists (in DesmosCalculator), so it's there when you
  // come back to it across questions and sessions.
  const [calcOpen, setCalcOpen] = useState(false);
  useEffect(() => {
    setCalcOpen(localStorage.getItem('desmos-open:qbank') === '1');
  }, []);
  const toggleCalc = () =>
    setCalcOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem('desmos-open:qbank', next ? '1' : '0');
      } catch {
        /* storage blocked — non-fatal */
      }
      return next;
    });

  // Reference sheet (math formulas) — opened from the header, like Bluebook.
  const [refOpen, setRefOpen] = useState(false);
  // Let the stopwatch be hidden so it isn't a distraction; the clock keeps
  // running underneath, just not shown, and "Show" brings it back.
  const [timerHidden, setTimerHidden] = useState(false);

  // Per-question count-up: the ref marks when the current question came on
  // screen; a low-frequency tick just forces the clock to re-render.
  const startedAtRef = useRef<number>(Date.now());
  const [, forceTick] = useState(0);

  // Dismiss the "More" menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const q = questions[index];
  const st = states[q.id] ?? EMPTY_STATE;
  const isMath = q.section === 'math';
  const isSpr = q.answer_format === 'spr';

  // Highlighter: a shared active tool, and one region each for the passage and
  // the question stem. Content is memoised per question id so the injected
  // <mark>s survive the taker's frequent re-renders (see highlighter.tsx).
  const [tool, setTool] = useState<HighlightTool>(null);
  const [hlOpen, setHlOpen] = useState(false);
  const hlRef = useRef<HTMLDivElement | null>(null);
  const passageHl = useHighlighter(`hl:qb:${q.id}:p`, tool);
  const stemHl = useHighlighter(`hl:qb:${q.id}:s`, tool);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const passageContent = useMemo(() => <RichText>{q.passage ?? ''}</RichText>, [q.id]);
  const stemContent = useMemo(
    () => (isMath ? <MathHtml html={q.question_text} /> : <RichText>{q.question_text}</RichText>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.id],
  );

  // Dismiss the highlighter popover on outside click / Escape.
  useEffect(() => {
    if (!hlOpen) return;
    const onDown = (e: MouseEvent) => {
      if (hlRef.current && !hlRef.current.contains(e.target as Node)) setHlOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHlOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [hlOpen]);

  // Reset the stopwatch origin whenever the visible question changes.
  useEffect(() => {
    startedAtRef.current = Date.now();
  }, [index]);

  // Tick only while the current question is still open (frozen once checked).
  useEffect(() => {
    if (st.result) return;
    const iv = setInterval(() => forceTick((t) => t + 1), 500);
    return () => clearInterval(iv);
  }, [index, st.result]);

  // Prefetch the answer the instant a question comes on screen so "Check" is
  // truly instant — the reveal is already cached by the time it's clicked, no
  // in-flight request, no loading spinner. Only MCQ can be prefetched: SPR
  // grid-ins grade server-side and record an attempt, so they're checked live.
  useEffect(() => {
    if (isSpr || st.result) return;
    void queryClient.prefetchQuery(trpc.questions.reveal.queryOptions({ questionId: q.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id, isSpr]);

  const check = useMutation(
    trpc.questions.check.mutationOptions({
      onSuccess: () => {
        // Counts and "already done" state shift the moment a question is
        // completed — refresh them so nothing goes stale within the session.
        queryClient.invalidateQueries(trpc.questions.domainCounts.queryFilter());
        queryClient.invalidateQueries(trpc.questions.getCompletedIds.queryFilter());
        queryClient.invalidateQueries(trpc.questionBanksManagement.list.queryFilter());
      },
    }),
  );

  const liveMs = st.result ? st.timeMs : st.timeMs + (Date.now() - startedAtRef.current);

  // Fold the current question's live time into its stored total before leaving
  // it, so revisiting keeps counting from where it left off.
  const persistCurrentTime = () => {
    const now = Date.now();
    setStates((s) => {
      const cur = s[q.id] ?? EMPTY_STATE;
      if (cur.result) return s;
      return { ...s, [q.id]: { ...cur, timeMs: cur.timeMs + (now - startedAtRef.current) } };
    });
  };

  const goTo = (i: number) => {
    if (i === index) return;
    persistCurrentTime();
    setNavOpen(false);
    setIndex(i);
  };

  const select = (letter: string) => {
    if (st.result) return; // locked once checked
    setStates((s) => {
      const cur = s[q.id] ?? EMPTY_STATE;
      return { ...s, [q.id]: { ...cur, selected: cur.selected === letter ? null : letter } };
    });
    // Prefetch the answer the moment a pick is committed, so "Check" is instant.
    // Fetching only after a selection keeps a set from being mined without an attempt.
    void queryClient.prefetchQuery(trpc.questions.reveal.queryOptions({ questionId: q.id }));
  };

  /** Cross out / restore one choice for the current question. */
  const toggleStrike = (letter: string) => {
    setStruck((s) => {
      const list = s[q.id] ?? [];
      return { ...s, [q.id]: list.includes(letter) ? list.filter((l) => l !== letter) : [...list, letter] };
    });
  };

  /** SPR grid-in: store the raw typed string as the selected answer. */
  const typeAnswer = (value: string) => {
    if (st.result) return;
    setStates((s) => {
      const cur = s[q.id] ?? EMPTY_STATE;
      return { ...s, [q.id]: { ...cur, selected: value === '' ? null : value } };
    });
  };

  const doCheck = async () => {
    if (st.result || !st.selected || checking) return; // an answer is required
    setChecking(true); // optimistic: show the loading indication right away
    const elapsed = st.timeMs + (Date.now() - startedAtRef.current);
    const selected = st.selected ?? undefined;

    let result: QResult;
    if (isSpr) {
      // Free-response grading is numeric and lives server-side; use the recorded
      // attempt's own result rather than a client-side letter comparison.
      const graded = await check
        .mutateAsync({ questionId: q.id, selectedAnswer: selected, timeSpentMs: elapsed })
        .finally(() => setChecking(false));
      result = {
        correctAnswer: graded.correctAnswer,
        explanation: graded.explanation,
        isCorrect: graded.isCorrect,
      };
    } else {
      // MCQ: reveal from the prefetched cache for instant feedback, then record.
      const revealed = await queryClient
        .ensureQueryData(trpc.questions.reveal.queryOptions({ questionId: q.id }))
        .finally(() => setChecking(false));
      const isCorrect =
        selected !== undefined
          ? selected.trim().toUpperCase() === revealed.correctAnswer.trim().toUpperCase()
          : null;
      result = { correctAnswer: revealed.correctAnswer, explanation: revealed.explanation, isCorrect };
      check.mutate({ questionId: q.id, selectedAnswer: selected, timeSpentMs: elapsed });
    }

    setStates((s) => ({
      ...s,
      [q.id]: { ...(s[q.id] ?? EMPTY_STATE), timeMs: elapsed, result },
    }));
  };

  const isLast = index === questions.length - 1;
  const options = (q.options as Opt[]) ?? [];

  // ── Completion summary ──────────────────────────────────────────────────
  if (finished) {
    const graded = questions.filter((qq) => states[qq.id]?.result?.isCorrect != null);
    const correct = graded.filter((qq) => states[qq.id]?.result?.isCorrect).length;
    const totalMs = questions.reduce((sum, qq) => sum + (states[qq.id]?.timeMs ?? 0), 0);
    const answered = questions.filter((qq) => states[qq.id]?.result).length;
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAF8F3] px-6 text-center text-[#23201B]">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#E6F4EC] text-[#2F855A]">
          <Icon name="checkmark-circle" className="text-h1" />
        </span>
        <h1 className="text-h1 font-semibold">Set complete</h1>
        <p className="mt-2 max-w-md text-body text-[#6B6559]">
          You checked {answered} of {questions.length} question{questions.length === 1 ? '' : 's'}.
          {graded.length > 0 && (
            <> Scored <span className="font-semibold text-[#23201B]">{correct}/{graded.length}</span>.</>
          )}{' '}
          Total time {fmtClock(totalMs)}. Everything is recorded in your history.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setFinished(false)}
            className="rounded-full border border-[#DED7C9] bg-white px-5 py-2 text-[13px] font-semibold text-[#6B6559] hover:bg-[#FFFDF8]"
          >
            Back to questions
          </button>
          <button
            onClick={onExit}
            className="rounded-full border border-[#2C46AD] bg-[#3B5BDB] px-6 py-2 text-[13px] font-semibold text-white shadow-[0_3px_0_#2C46AD] hover:-translate-y-px"
          >
            Build another set
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-[#FAF8F3] text-[#23201B]">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#ECE6DA] bg-white/70 px-6 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate rounded-full bg-[#23201B] px-3 py-1 text-[12px] font-semibold text-white">
            Question Bank
          </span>
          <span className="hidden truncate text-[12px] text-[#6B6559] sm:inline">{scopeLabel}</span>
        </div>

        {/* Per-question stopwatch, with a hide/show toggle beneath it. */}
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-2 rounded-full border border-[#E4DECF] bg-[#FFFDF8] px-4 py-1.5">
            <span className="h-2 w-2 rounded-full bg-[#3B5BDB]" />
            <span className="text-[15px] font-semibold tabular-nums text-[#23201B]">
              {timerHidden ? '—:—' : fmtClock(liveMs)}
            </span>
          </div>
          <button
            onClick={() => setTimerHidden((h) => !h)}
            className="rounded-full px-2 text-[11px] leading-4 text-[#9A9280] hover:text-[#6B6559]"
          >
            {timerHidden ? 'Show' : 'Hide'}
          </button>
        </div>

        <div className="flex items-center gap-4">
          {isMath && (
            <button
              onClick={() => setRefOpen(true)}
              title="SAT math reference sheet"
              className="flex items-center gap-1.5 rounded-md text-[12px] text-[#9A9280] hover:text-[#6B6559]"
            >
              <span aria-hidden className="text-[14px] leading-none">📐</span>
              Reference
            </button>
          )}
          {isMath && (
            <button
              onClick={toggleCalc}
              aria-pressed={calcOpen}
              title={calcOpen ? 'Hide calculator' : 'Show graphing calculator'}
              className={cn(
                'flex items-center gap-1.5 rounded-md text-[12px] hover:text-[#6B6559]',
                calcOpen ? 'text-[#3B5BDB]' : 'text-[#9A9280]',
              )}
            >
              <span aria-hidden className="text-[14px] leading-none">🖩</span>
              Calculator
            </button>
          )}
          {/* Highlighter — pick a colour, drag over passage/question to mark it. */}
          <div className="relative" ref={hlRef}>
            <button
              onClick={() => setHlOpen((o) => !o)}
              aria-pressed={tool != null}
              title="Highlighter"
              className={cn(
                'flex items-center gap-1.5 rounded-md text-[12px] hover:text-[#6B6559]',
                tool != null ? 'text-[#3B5BDB]' : 'text-[#9A9280]',
              )}
            >
              <span aria-hidden className="text-[14px] leading-none">🖍️</span>
              Highlight
            </button>
            {hlOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 rounded-xl border border-[#E7E0D2] bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
                <HighlightSwatches
                  tool={tool}
                  onTool={setTool}
                  onClear={() => {
                    passageHl.clear();
                    stemHl.clear();
                  }}
                />
              </div>
            )}
          </div>

          {/* "More" menu — houses the optional difficulty reveal. */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-1 rounded-md text-[12px] text-[#9A9280] hover:text-[#6B6559]"
            >
              More
              <span aria-hidden className="text-[10px]">▾</span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-10 mt-2 w-52 overflow-hidden rounded-xl border border-[#E7E0D2] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
              >
                <button
                  role="menuitemcheckbox"
                  aria-checked={showDifficulty}
                  onClick={() => {
                    setShowDifficulty((s) => !s);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] text-[#23201B] hover:bg-[#FAF8F3]"
                >
                  Show difficulty
                  <span
                    className={
                      'flex h-4 w-4 items-center justify-center rounded-[5px] border text-[10px] font-bold ' +
                      (showDifficulty
                        ? 'border-[#3B5BDB] bg-[#3B5BDB] text-white'
                        : 'border-[#CFC7B4] text-transparent')
                    }
                  >
                    ✓
                  </span>
                </button>
                <button
                  role="menuitemcheckbox"
                  aria-checked={eliminating}
                  onClick={() => {
                    setEliminating((e) => !e);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] text-[#23201B] hover:bg-[#FAF8F3]"
                >
                  Cross out answers
                  <span
                    className={
                      'flex h-4 w-4 items-center justify-center rounded-[5px] border text-[10px] font-bold ' +
                      (eliminating
                        ? 'border-[#3B5BDB] bg-[#3B5BDB] text-white'
                        : 'border-[#CFC7B4] text-transparent')
                    }
                  >
                    ✓
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onExit}
            className="flex items-center gap-1.5 text-[12px] text-[#9A9280] hover:text-[#6B6559]"
          >
            <Icon name="close" className="text-small" />
            Exit
          </button>
        </div>
      </header>

      {/* Split panes — R&W: passage | question. Math: single column, or
          calculator | question when the Desmos panel is open. */}
      <main
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1',
          (!isMath || (isMath && calcOpen)) && 'md:grid-cols-2',
        )}
      >
        {/* Left (math): the graphing calculator, its own half of the screen. */}
        {isMath && calcOpen && (
          <section className="min-h-0 border-[#ECE6DA] md:border-r">
            <DesmosCalculator storageKey="desmos:qbank" className="h-full w-full" />
          </section>
        )}

        {/* Left: passage / figure — R&W only. */}
        {!isMath && (
        <section className="min-h-0 overflow-y-auto border-[#ECE6DA] px-8 py-8 md:border-r md:px-10">
          <div className="mx-auto max-w-[38rem]">
            <QuestionFigure url={q.visual_url} description={q.visual_data} className="mb-4" />
            {q.passage ? (
              <>
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B0A891]">
                  Passage
                </p>
                <div className="rounded-2xl border border-[#EFE9DC] bg-[#FFFDF8] px-7 py-6 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                  <p
                    key={q.id}
                    ref={passageHl.ref}
                    onMouseUp={passageHl.onMouseUp}
                    className={cn('qb-reading whitespace-pre-line text-[#2E2A23]', tool && 'cursor-text')}
                  >
                    {passageContent}
                  </p>
                </div>
              </>
            ) : (
              !q.visual_url && (
                <p className="mt-2 text-[13px] italic text-[#B0A891]">
                  No passage — read the question on the right.
                </p>
              )
            )}
          </div>
        </section>
        )}

        {/* Right: question + choices */}
        <section className="min-h-0 overflow-y-auto border-t border-[#ECE6DA] px-8 py-8 md:border-t-0 md:px-10">
          <div className="mx-auto max-w-[38rem]">
            {/* Meta row */}
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3B5BDB] text-[15px] font-bold text-white shadow-[0_2px_0_#2C46AD]">
                {index + 1}
              </span>
              {q.skill && (
                <span className="rounded-full bg-[#EEF2FF] px-2.5 py-1 text-[12px] font-medium text-[#3B5BDB]">
                  {q.skill}
                </span>
              )}
              {showDifficulty && q.difficulty && (
                <span className="rounded-full bg-[#FBEEE6] px-2.5 py-1 text-[12px] font-medium capitalize text-[#C2683B]">
                  {q.difficulty}
                </span>
              )}
            </div>

            {/* Question stem — highlightable, memoised so marks persist. */}
            <div
              key={q.id}
              ref={stemHl.ref}
              onMouseUp={stemHl.onMouseUp}
              className={cn('qb-reading mb-6 text-[#23201B]', !isMath && 'font-bold', tool && 'cursor-text')}
            >
              {stemContent}
            </div>

            {/* Answer: free-response (SPR) or multiple choice */}
            {isSpr ? (
              <div className="max-w-xs">
                <label className="mb-2 block text-[12px] font-semibold text-[#6B6559]">Your answer</label>
                <input
                  type="text"
                  autoComplete="off"
                  disabled={!!st.result}
                  value={st.selected ?? ''}
                  onChange={(e) => typeAnswer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doCheck(); }}
                  placeholder="e.g. 3/4 or 0.75"
                  className={cn(
                    'qb-reading w-full rounded-2xl border px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-[#3B5BDB]',
                    st.result
                      ? st.result.isCorrect
                        ? 'border-[#2F855A] bg-[#E6F4EC]'
                        : 'border-[#C2415A] bg-[#FBE9EC]'
                      : 'border-[#E7E0D2] bg-white',
                  )}
                />
                {st.result && (
                  <p className="mt-2 text-[13px] text-[#6B6559]">
                    Accepted answer{st.result.correctAnswer.includes(',') ? 's' : ''}:{' '}
                    <span className="font-semibold text-[#23201B]">{st.result.correctAnswer}</span>
                  </p>
                )}
              </div>
            ) : (
            <div role="radiogroup" aria-label="Answer choices" className="space-y-3">
              {options.map((opt) => {
                const isSel = st.selected === opt.letter;
                const isCorrect = st.result?.correctAnswer === opt.letter;
                const isWrongPick = st.result && isSel && !isCorrect;
                const isStruck = (struck[q.id] ?? []).includes(opt.letter);
                return (
                  <div key={opt.letter} className="flex items-center gap-2">
                    <button
                      role="radio"
                      aria-checked={isSel}
                      disabled={!!st.result}
                      onClick={() => select(opt.letter)}
                      className={cn(
                        'group flex flex-1 items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B5BDB]',
                        st.result
                          ? isCorrect
                            ? 'border-[#2F855A] bg-[#E6F4EC]'
                            : isWrongPick
                              ? 'border-[#C2415A] bg-[#FBE9EC]'
                              : 'border-[#E7E0D2] bg-white opacity-70'
                          : isSel
                            ? 'border-[#3B5BDB] bg-[#EEF2FF] shadow-[0_2px_0_rgba(59,91,219,0.18)]'
                            : 'border-[#E7E0D2] bg-white hover:border-[#C9C0AD] hover:bg-[#FFFDF8]',
                        isStruck && !st.result && 'opacity-45',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold transition-colors',
                          st.result
                            ? isCorrect
                              ? 'border-[#2F855A] bg-[#2F855A] text-white'
                              : isWrongPick
                                ? 'border-[#C2415A] bg-[#C2415A] text-white'
                                : 'border-[#CFC7B4] text-[#6B6559]'
                            : isSel
                              ? 'border-[#3B5BDB] bg-[#3B5BDB] text-white'
                              : 'border-[#CFC7B4] text-[#6B6559] group-hover:border-[#A9A08B]',
                        )}
                      >
                        {opt.letter}
                      </span>
                      <span className={cn('qb-reading flex-1 text-[#2E2A23]', isStruck && !st.result && 'line-through')}>
                        {isMath ? <MathHtml html={opt.text} block={false} /> : <RichText>{opt.text}</RichText>}
                      </span>
                    </button>

                    {/* Subtle per-choice eliminator, shown when the toggle is on. */}
                    {eliminating && !st.result && (
                      <button
                        onClick={() => toggleStrike(opt.letter)}
                        aria-label={`${isStruck ? 'Restore' : 'Cross out'} choice ${opt.letter}`}
                        aria-pressed={isStruck}
                        title={isStruck ? 'Restore answer' : 'Cross out answer'}
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B5BDB]',
                          isStruck
                            ? 'border-[#6B6559] bg-[#6B6559] text-white'
                            : 'border-transparent text-[#B0A891] hover:border-[#CFC7B4] hover:text-[#6B6559]',
                        )}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            )}

            {/* Check / result */}
            {!st.result ? (
              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={doCheck}
                  disabled={!st.selected}
                  className="rounded-full border border-[#2C46AD] bg-[#3B5BDB] px-6 py-2 text-[13px] font-semibold text-white shadow-[0_3px_0_#2C46AD] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_4px_0_#2C46AD] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:border-[#DED7C9] disabled:bg-[#E9E4D8] disabled:text-[#9A9280] disabled:shadow-none disabled:hover:translate-y-0"
                >
                  {checking ? (
                    <span className="flex items-center gap-1">
                      Checking
                      <LoadingDots />
                    </span>
                  ) : (
                    'Check answer'
                  )}
                </button>
                {!st.selected && (
                  <span className="text-[12px] text-[#B0A891]">Choose an answer first</span>
                )}
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {/* Verdict */}
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold',
                    st.result.isCorrect == null
                      ? 'bg-[#F1EEE6] text-[#6B6559]'
                      : st.result.isCorrect
                        ? 'bg-[#E6F4EC] text-[#2F855A]'
                        : 'bg-[#FBE9EC] text-[#C2415A]',
                  )}
                >
                  <Icon
                    name={st.result.isCorrect ? 'checkmark-circle' : 'close'}
                    className="text-body"
                  />
                  {st.result.isCorrect == null
                    ? `Answer: ${st.result.correctAnswer}`
                    : st.result.isCorrect
                      ? 'Correct'
                      : `Incorrect — answer is ${st.result.correctAnswer}`}
                </div>

                {st.result.explanation && (
                  <div className="rounded-xl bg-[#FFFDF8] px-4 py-3 ring-1 ring-[#EFE9DC]">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#B0A891]">
                      Explanation
                    </p>
                    {/* Math explanations are rich HTML (MathML/figures); R&W is
                        whitelisted text. Using <RichText> for math would leak raw
                        <math>/<p>/<span> tags as literal text. */}
                    {isMath ? (
                      <div className="qb-reading text-[#4A453B]">
                        <MathHtml html={st.result.explanation} />
                      </div>
                    ) : (
                      <p className="qb-reading whitespace-pre-line text-[#4A453B]">
                        <RichText>{st.result.explanation}</RichText>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-[#ECE6DA] bg-white px-6 py-3">
        <span className="text-[13px] font-semibold tabular-nums text-[#23201B]">
          {String(index + 1).padStart(2, '0')}
          <span className="text-[#B0A891]"> / {questions.length}</span>
        </span>

        {/* Navigator trigger */}
        <button
          onClick={() => setNavOpen(true)}
          className="rounded-full border border-[#E4DECF] px-4 py-1.5 text-[13px] font-medium text-[#6B6559] hover:bg-[#FAF8F3]"
        >
          Question {index + 1} of {questions.length} ⌄
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="rounded-full border border-[#DED7C9] bg-white px-5 py-2 text-[13px] font-semibold text-[#6B6559] transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={() => (isLast ? setFinished(true) : goTo(index + 1))}
            className="rounded-full border border-[#2C46AD] bg-[#3B5BDB] px-6 py-2 text-[13px] font-semibold text-white shadow-[0_3px_0_#2C46AD] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_4px_0_#2C46AD] active:translate-y-[3px] active:shadow-none"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </footer>

      {/* Navigator panel */}
      {navOpen && (
        <QuestionNavigator
          questions={questions}
          states={states}
          current={index}
          onJump={goTo}
          onClose={() => setNavOpen(false)}
          onFinish={() => {
            persistCurrentTime();
            setNavOpen(false);
            setFinished(true);
          }}
        />
      )}

      {/* SAT math reference sheet — opened from the header's "Reference". */}
      <SatReferenceSheet open={refOpen} onClose={() => setRefOpen(false)} />
    </div>
  );
}

/* ── Navigator: a grid of every question in the set, with per-item state ───── */

function QuestionNavigator({
  questions,
  states,
  current,
  onJump,
  onClose,
  onFinish,
}: {
  questions: BuiltQuestion[];
  states: Record<string, QState>;
  current: number;
  onJump: (i: number) => void;
  onClose: () => void;
  onFinish: () => void;
}) {
  const answered = questions.filter((q) => states[q.id]?.result).length;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <div className="relative w-full max-w-lg rounded-t-2xl border border-[#ECE6DA] bg-[#FAF8F3] p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-[#23201B]">All questions</h2>
            <p className="text-[12px] text-[#6B6559]">
              {answered} of {questions.length} checked
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#9A9280] hover:bg-[#ECE6DA]"
          >
            <Icon name="close" className="text-body" />
          </button>
        </div>

        <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
          {questions.map((q, i) => {
            const res = states[q.id]?.result;
            const isCurrent = i === current;
            return (
              <button
                key={q.id}
                onClick={() => onJump(i)}
                aria-current={isCurrent}
                className={cn(
                  'flex h-10 items-center justify-center rounded-lg border text-[13px] font-semibold tabular-nums transition-colors',
                  res
                    ? res.isCorrect == null
                      ? 'border-[#CFC7B4] bg-white text-[#6B6559]'
                      : res.isCorrect
                        ? 'border-[#2F855A]/50 bg-[#E6F4EC] text-[#2F855A]'
                        : 'border-[#C2415A]/50 bg-[#FBE9EC] text-[#C2415A]'
                    : 'border-[#E4DECF] bg-white text-[#6B6559] hover:border-[#C9C0AD]',
                  isCurrent && 'ring-2 ring-[#3B5BDB] ring-offset-1 ring-offset-[#FAF8F3]',
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* Legend + finish */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-[11px] text-[#6B6559]">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-[#2F855A]/50 bg-[#E6F4EC]" /> Correct
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-[#C2415A]/50 bg-[#FBE9EC]" /> Wrong
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-[#E4DECF] bg-white" /> Not done
            </span>
          </div>
          <button
            onClick={onFinish}
            className="rounded-full border border-[#DED7C9] bg-white px-4 py-1.5 text-[12px] font-semibold text-[#6B6559] hover:bg-[#FFFDF8]"
          >
            Finish set
          </button>
        </div>
      </div>
    </div>
  );
}
