'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';
import { QuestionFigure } from '@/components/question-figure';
import { RichText } from '@/components/rich-text';
import { MathHtml } from '@/components/math-html';
import { DesmosCalculator } from '@/components/desmos-calculator';
import { SatReferenceSheet } from '@/components/sat-reference-sheet';
import { HighlightSwatches, useHighlighter, type HighlightTool } from '@/components/highlighter';

/**
 * The sitting screen, styled to mimic Bluebook — the real digital SAT app.
 *
 * This is the one screen that deliberately ignores the app's design tokens.
 * Practising on the same chrome, split-pane layout, and serif type as the exam
 * means the reading rhythm transfers on test day, so Bluebook's palette and
 * typography are hard-coded here rather than themed.
 */

const LETTERS = ['A', 'B', 'C', 'D'] as const;

type QuestionOption = { letter: string; text: string };

/** Bluebook's own palette. Local to this screen by design. */
const BB = {
  chrome: '#E7EAF4', // header/footer wash
  rule: '#C9CEE0',
  navy: '#1D2A5B', // question-number badge, buttons, answered tiles
  blue: '#324DC7', // selection, focus
  ink: '#1B1B1B',
  optionBorder: '#A6ABB8',
} as const;

export default function TestPage() {
  const router = useRouter();
  const { id: attemptId } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const attempt = useQuery(trpc.tests.getAttempt.queryOptions({ attemptId }));
  const saved = useQuery(trpc.answers.listForAttempt.queryOptions({ attemptId }));

  const [current, setCurrent] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [eliminating, setEliminating] = useState(false);
  const [struck, setStruck] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  // Set the instant the countdown hits zero. Freezes the sitting — answers lock,
  // navigation stops — and drives the blocking "Time's up" overlay while the
  // auto-submit runs. Stays true even if that submit errors, so the student
  // can't keep answering past the deadline; they only get a retry.
  const [timeExpired, setTimeExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // Client-side bridge for the countdown anchor between `begin` succeeding and
  // the refetched attempt carrying `resumedAt`. Null until the timer has begun.
  const [beganAt, setBeganAt] = useState<string | null>(null);
  const [timerHidden, setTimerHidden] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  // Desmos panel — like Bluebook's math calculator. Its open/closed choice is
  // remembered per sitting so reopening the test brings the panel back as it was.
  const [calcOpen, setCalcOpen] = useState(false);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    setCalcOpen(localStorage.getItem(`desmos-open:${attemptId}`) === '1');
  }, [attemptId]);

  const toggleCalc = () =>
    setCalcOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(`desmos-open:${attemptId}`, next ? '1' : '0');
      } catch {
        /* storage blocked — non-fatal */
      }
      return next;
    });

  // Per-question dwell time (ms), so pace can be computed later. `qStartedAt`
  // marks when the visible question came on screen; `timeByQuestion` holds the
  // running total per question id; `prevQid` lets the nav effect flush the
  // question being left.
  const qStartedAt = useRef<number>(Date.now());
  const timeByQuestion = useRef<Record<string, number>>({});
  const prevQid = useRef<string | null>(null);

  /** Fold elapsed-since-onscreen into a question's total and restart the clock. */
  const accumulateTime = useCallback((qid: string) => {
    const now = Date.now();
    const total = (timeByQuestion.current[qid] ?? 0) + (now - qStartedAt.current);
    timeByQuestion.current[qid] = total;
    qStartedAt.current = now;
    return total;
  }, []);

  const questions = useMemo(() => attempt.data?.questions ?? [], [attempt.data]);

  // Highlighter — a shared active tool plus a region each for the passage and the
  // question stem. Defined here (before the early returns) to keep hook order
  // stable; content is memoised per question id so the injected marks survive the
  // countdown's twice-a-second re-render (see highlighter.tsx).
  const currentQ = questions[current];
  const currentQid = currentQ?.id ?? 'none';
  const [tool, setTool] = useState<HighlightTool>(null);
  const [hlOpen, setHlOpen] = useState(false);
  const hlRef = useRef<HTMLDivElement | null>(null);
  const passageHl = useHighlighter(`hl:test:${currentQid}:p`, tool);
  const stemHl = useHighlighter(`hl:test:${currentQid}:s`, tool);
  const passageContent = useMemo(
    () => <RichText>{currentQ?.passage ?? ''}</RichText>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentQid],
  );
  const stemIsMath = (currentQ as { section?: string } | undefined)?.section === 'math';
  const stemContent = useMemo(
    () =>
      stemIsMath ? (
        <MathHtml html={currentQ?.question_text ?? ''} />
      ) : (
        <RichText>{currentQ?.question_text ?? ''}</RichText>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentQid],
  );

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

  // Rehydrate picks and flags — a refresh mid-sitting must not lose work.
  useEffect(() => {
    if (!saved.data) return;
    const a: Record<string, string | null> = {};
    const f: Record<string, boolean> = {};
    for (const row of saved.data) {
      a[row.question_id] = row.selected_answer;
      f[row.question_id] = row.flagged;
    }
    setAnswers((prev) => ({ ...a, ...prev }));
    setFlags((prev) => ({ ...f, ...prev }));
  }, [saved.data]);

  const save = useMutation(trpc.answers.save.mutationOptions());

  // Strict-ordering autosave queue. Every write goes through here and is chained
  // after the previous one, so two saves to the same (attempt, question) row can
  // never commit out of order — no matter how the network reorders requests.
  // This is the actual guarantee against the truncation bug (typing "94" saved
  // as "9"): the earlier keystroke's write can no longer overtake the later one.
  // Debouncing below still cuts the number of writes; ordering is what makes the
  // race impossible rather than merely rare. Errors are swallowed (autosave is
  // best-effort and also flushed on leave/submit) but never break the chain.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback(
    (payload: {
      attemptId: string;
      questionId: string;
      selectedAnswer?: string | null;
      flagged?: boolean;
      timeSpentMs?: number;
    }) => {
      saveChain.current = saveChain.current
        .catch(() => {})
        .then(() => save.mutateAsync(payload))
        .catch(() => {});
    },
    [save],
  );

  // Latest answers in a ref so the debounced/flush saves below read the current
  // value without a stale closure.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // ── SPR autosave: debounced, then flushed on leave/submit ──────────────────
  // Each keystroke used to fire its own save.mutate. Those writes hit the same
  // (attempt, question) row concurrently with no ordering guarantee, so an
  // earlier keystroke's value could commit last — typing "94" was saved as "9",
  // "-12" as "-1". Debouncing coalesces a burst into one write, and every
  // question-change / submit flushes the final typed value as a single
  // authoritative save, so the last thing on screen is always what's stored.
  const sprSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sprPendingQid = useRef<string | null>(null);

  /**
   * Persist a question's answer + banked time in one write, cancelling any
   * pending debounced SPR save for it first. One write per call means no
   * concurrent same-row upserts, so writes can't land out of order.
   */
  const flushSave = useCallback(
    (qid: string) => {
      if (sprSaveTimer.current && sprPendingQid.current === qid) {
        clearTimeout(sprSaveTimer.current);
        sprSaveTimer.current = null;
        sprPendingQid.current = null;
      }
      enqueueSave({
        attemptId,
        questionId: qid,
        selectedAnswer: answersRef.current[qid] ?? null,
        timeSpentMs: accumulateTime(qid),
      });
    },
    [attemptId, enqueueSave, accumulateTime],
  );

  // Cancel a dangling debounce timer on unmount.
  useEffect(() => () => {
    if (sprSaveTimer.current) clearTimeout(sprSaveTimer.current);
  }, []);

  // When the visible question changes, flush the one being left — its final
  // answer and the time spent on it — even if the student never re-picks.
  useEffect(() => {
    const nextQid = questions[current]?.id ?? null;
    const leaving = prevQid.current;
    if (leaving && leaving !== nextQid) {
      flushSave(leaving);
    }
    qStartedAt.current = Date.now();
    prevQid.current = nextQid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, questions]);

  const submit = useMutation(
    trpc.tests.submit.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        router.replace(`/test/${attemptId}/results`);
      },
      onError: (e) => {
        setError(e.message);
        setSubmitted(false);
      },
    }),
  );

  // Pause: freeze the countdown and leave. Answers are already autosaved, so this
  // only stops the clock server-side, then returns to Practice to resume later.
  const pause = useMutation(
    trpc.tests.pause.mutationOptions({
      onSuccess: () => router.push('/dashboard/practice'),
      onError: (e) => setError(e.message),
    }),
  );

  // Resume: restart the countdown from the remaining time, then refetch so the
  // taker unfreezes with a fresh deadline.
  const resume = useMutation(
    trpc.tests.resume.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.tests.getAttempt.queryFilter()),
      onError: (e) => setError(e.message),
    }),
  );

  // Begin: anchor the countdown the moment the questions are on screen, not when
  // the attempt was created — so the fetch/navigation gap doesn't cost exam time.
  // Idempotent server-side (only stamps a null resumed_at), so a refresh is safe.
  const begin = useMutation(
    trpc.tests.begin.mutationOptions({
      onSuccess: (r) => setBeganAt(r.resumedAt),
      onError: (e) => setError(e.message),
    }),
  );

  const doSubmit = useCallback(() => {
    if (submitted) return;
    setError(null);
    setSubmitted(true);
    // Flush the on-screen question's final answer and its time before grading,
    // so a value still sitting in the debounce is never lost at submit.
    const leaving = prevQid.current;
    if (leaving) {
      flushSave(leaving);
    }
    const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
    submit.mutate({ attemptId, timeUsedSeconds: elapsed });
  }, [submitted, submit, attemptId, flushSave]);

  // Countdown, mirroring Bluebook's m:ss readout in the header.
  const timerSeconds = attempt.data?.timerSeconds ?? null;
  const isTimed = Boolean(attempt.data?.timed && timerSeconds);

  // Pause/resume timing. `resumedAt` anchors the current running segment and
  // `timeUsedSeconds` is the active time already banked in earlier segments, so
  // the deadline is the *remaining* time counted from when the sitting last
  // resumed — a pause genuinely stops the clock, and a refresh resumes the same
  // countdown. Each tick derives from the wall clock, so a throttled tab can't
  // drift. `resumedAt` is null until `begin` fires (below): the countdown only
  // starts once the questions are on screen, not when the attempt was created.
  const paused = attempt.data?.status === 'paused';
  const timeUsedSeconds = attempt.data?.timeUsedSeconds ?? 0;
  // Prefer the server value; `beganAt` bridges the gap until the refetch lands.
  const resumedAt = attempt.data?.resumedAt ?? beganAt ?? null;
  const deadline = useMemo(() => {
    if (!isTimed || timerSeconds === null || !resumedAt) return null;
    return new Date(resumedAt).getTime() + Math.max(0, timerSeconds - timeUsedSeconds) * 1000;
  }, [isTimed, timerSeconds, resumedAt, timeUsedSeconds]);

  // Start the countdown when the questions render — fire `begin` once, only for a
  // running timed sitting whose clock hasn't been anchored yet. A paused sitting
  // waits for the explicit Resume; a refresh mid-sitting already has a server
  // `resumedAt`, so this stays idle and never rewinds the clock.
  const beginFired = useRef(false);
  useEffect(() => {
    if (beginFired.current) return;
    if (!isTimed || paused || submitted) return;
    if (!attempt.data || attempt.data.resumedAt) return; // no data yet, or already begun
    beginFired.current = true;
    begin.mutate({ attemptId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimed, paused, submitted, attempt.data, attemptId]);

  // Auto-submit must fire from inside the interval, but `doSubmit`'s identity
  // changes every render (it closes over the submit mutation). Holding it in a
  // ref keeps the interval effect from tearing down and restarting each render —
  // the bug that made the old timer reset itself and appear to freeze.
  const doSubmitRef = useRef(doSubmit);
  useEffect(() => {
    doSubmitRef.current = doSubmit;
  }, [doSubmit]);

  // Mirror the frozen state into a ref so the always-on keydown listener can
  // read it without being torn down and re-added on every lock change.
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = submitted || timeExpired;
  }, [submitted, timeExpired]);

  useEffect(() => {
    // A paused sitting must not tick — its frozen deadline may already be in the
    // past, which would otherwise auto-submit the moment it loads.
    if (deadline === null || paused) return;
    let fired = false;
    const tick = () => {
      const secsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(secsLeft);
      if (secsLeft <= 0 && !fired) {
        fired = true;
        // Lock the sitting and kick off the submit in the same tick, so both
        // state updates batch into one render — the overlay opens straight to
        // "Submitting…" with no flash of an in-between state.
        setTimeExpired(true);
        doSubmitRef.current();
      }
    };
    tick(); // paint the correct value immediately, no one-second flash
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline, paused]);

  // Keyboard eliminator: ⌘⌥1..4 (Ctrl+Alt on non-Mac) crosses out choice A..D,
  // pressing the same combo again restores it — a fast way to narrow answers.
  // `event.code` is used, not `event.key`, because Option+digit on macOS yields
  // glyphs like "¡"; the physical Digit1..Digit4 codes are layout-independent.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (lockedRef.current) return;
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      const match = /^Digit([1-4])$/.exec(e.code);
      if (!match) return;
      const qid = questions[current]?.id;
      const opts = (questions[current]?.options as QuestionOption[]) ?? [];
      const index = Number(match[1]) - 1;
      if (!qid || index >= opts.length) return;
      const letter = opts[index]?.letter ?? LETTERS[index];
      e.preventDefault();
      setStruck((prev) => {
        const list = prev[qid] ?? [];
        return {
          ...prev,
          [qid]: list.includes(letter) ? list.filter((l) => l !== letter) : [...list, letter],
        };
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [questions, current]);

  if (attempt.isLoading) {
    return (
      <div className="dsat-text flex min-h-dvh items-center justify-center text-[#1B1B1B]">
        Loading your test…
      </div>
    );
  }

  if (attempt.isError || questions.length === 0) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="dsat-text text-[#1B1B1B]">
          {attempt.error?.message ?? 'This test has no questions to sit.'}
        </p>
        <button
          onClick={() => router.push('/dashboard/practice')}
          className="rounded-full bg-[#1D2A5B] px-5 py-2 text-[13px] font-semibold text-white"
        >
          Back to practice
        </button>
      </div>
    );
  }

  const q = questions[current];
  const isMath = (q as { section?: string }).section === 'math';
  const isSpr = (q as { answer_format?: string }).answer_format === 'spr';
  const sectionTitle = isMath ? 'Section 2: Math' : 'Section 1: Reading and Writing';
  const answeredCount = questions.filter((qq) => answers[qq.id]).length;
  const options = ((q.options as QuestionOption[]) ?? []).map((o, i) => ({
    letter: o.letter ?? LETTERS[i],
    text: o.text,
  }));

  // Once the timer expires (or a submit is in flight) the sitting is frozen:
  // no more picking, typing, flagging, or crossing out.
  const locked = submitted || timeExpired;

  const select = (letter: string) => {
    if (locked) return;
    const next = answers[q.id] === letter ? null : letter;
    setAnswers((prev) => ({ ...prev, [q.id]: next }));
    enqueueSave({
      attemptId,
      questionId: q.id,
      selectedAnswer: next,
      timeSpentMs: accumulateTime(q.id),
    });
  };

  /**
   * SPR grid-in: reflect the typed string immediately (local state keeps the
   * field responsive) but debounce the network save so a burst of keystrokes
   * becomes one write instead of many racing same-row upserts. The final value
   * is also flushed on question-change / submit via `flushSave`, so nothing
   * typed can be lost.
   */
  const typeAnswer = (value: string) => {
    if (locked) return;
    const next = value === '' ? null : value;
    const qid = q.id;
    setAnswers((prev) => ({ ...prev, [qid]: next }));
    if (sprSaveTimer.current) clearTimeout(sprSaveTimer.current);
    sprPendingQid.current = qid;
    sprSaveTimer.current = setTimeout(() => {
      sprSaveTimer.current = null;
      sprPendingQid.current = null;
      enqueueSave({
        attemptId,
        questionId: qid,
        selectedAnswer: answersRef.current[qid] ?? null,
        timeSpentMs: accumulateTime(qid),
      });
    }, 500);
  };

  const toggleFlag = () => {
    if (locked) return;
    const next = !flags[q.id];
    setFlags((prev) => ({ ...prev, [q.id]: next }));
    enqueueSave({ attemptId, questionId: q.id, flagged: next, timeSpentMs: accumulateTime(q.id) });
  };

  const toggleStrike = (letter: string) => {
    if (locked) return;
    setStruck((prev) => {
      const list = prev[q.id] ?? [];
      return {
        ...prev,
        [q.id]: list.includes(letter) ? list.filter((l) => l !== letter) : [...list, letter],
      };
    });
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex h-dvh flex-col bg-white text-[#1B1B1B]">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header
        className="grid shrink-0 grid-cols-3 items-center px-6 py-2.5"
        style={{ backgroundColor: BB.chrome }}
      >
        <div>
          <h1 className="text-[15px] font-bold leading-tight">{sectionTitle}</h1>
          <button
            onClick={() => setExiting(true)}
            className="mt-0.5 flex items-center gap-1.5 rounded border border-[#5B6178] px-2 py-0.5 text-[12px] font-semibold hover:bg-white/60"
          >
            <span aria-hidden>⏸</span> Pause &amp; Exit
          </button>
        </div>

        <div className="flex flex-col items-center">
          <div className="text-[19px] font-semibold tabular-nums">
            {!isTimed ? 'Untimed' : timerHidden ? ' ' : mmss(remaining ?? timerSeconds ?? 0)}
          </div>
          {isTimed && (
            <button
              onClick={() => setTimerHidden((h) => !h)}
              className="mt-0.5 rounded-full border border-[#5B6178] px-3 text-[12px] leading-5 hover:bg-white/60"
            >
              {timerHidden ? 'Show' : 'Hide'}
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-5 text-[11px]">
          {isMath && (
            <button
              onClick={() => setRefOpen(true)}
              title="SAT math reference sheet"
              className="flex flex-col items-center gap-0.5 hover:opacity-70"
            >
              <span aria-hidden className="text-[15px] leading-none">📐</span>
              Reference
            </button>
          )}
          {isMath && (
            <button
              onClick={toggleCalc}
              aria-pressed={calcOpen}
              title={calcOpen ? 'Hide calculator' : 'Show graphing calculator'}
              className={cn(
                'flex flex-col items-center gap-0.5 hover:opacity-70',
                calcOpen && 'text-[#324DC7]',
              )}
            >
              <span aria-hidden className="text-[15px] leading-none">🖩</span>
              Calculator
            </button>
          )}
          {/* Highlighter — pick a colour, drag over the passage/question to mark it. */}
          <div className="relative" ref={hlRef}>
            <button
              onClick={() => setHlOpen((o) => !o)}
              aria-pressed={tool != null}
              title="Highlighter"
              className={cn('flex flex-col items-center gap-0.5 hover:opacity-70', tool != null && 'text-[#324DC7]')}
            >
              <span aria-hidden className="text-[15px]">🖍️</span>
              Highlights
            </button>
            {hlOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 rounded-xl border border-[#C9CEE0] bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
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
          <button
            onClick={() => setReviewing(true)}
            className="flex flex-col items-center gap-0.5 hover:opacity-70"
          >
            <span aria-hidden className="text-[15px]">⋮</span>
            More
          </button>
        </div>
      </header>

      <div className="w-full border-b border-dashed" style={{ borderColor: BB.rule }} />

      {reviewing ? (
        <ReviewPanel
          title={sectionTitle}
          questions={questions}
          answers={answers}
          flags={flags}
          onJump={(i) => {
            setCurrent(i);
            setReviewing(false);
          }}
          onClose={() => setReviewing(false)}
        />
      ) : (
        /* ── Split panes. R&W: passage | question. Math: single column, or
              calculator | question when the Desmos panel is open. ── */
        <main
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1',
            (!isMath || (isMath && calcOpen)) && 'md:grid-cols-2',
          )}
        >
          {/* Left: stimulus — R&W only; a math stem carries its own figure. */}
          {!isMath && (
          <section
            className="min-h-0 overflow-y-auto px-8 py-6 md:border-r"
            style={{ borderColor: '#6B7280' }}
          >
            <QuestionFigure
              url={(q as { visual_url?: string | null }).visual_url}
              description={(q as { visual_data?: string | null }).visual_data}
            />
            {q.passage && (
              <div
                key={q.id}
                ref={passageHl.ref}
                onMouseUp={passageHl.onMouseUp}
                className={cn('dsat-text whitespace-pre-line', tool && 'cursor-text')}
              >
                {passageContent}
              </div>
            )}
          </section>
          )}

          {/* Left (math): the graphing calculator, its own half of the screen. */}
          {isMath && calcOpen && (
            <section className="min-h-0 md:border-r" style={{ borderColor: '#6B7280' }}>
              <DesmosCalculator storageKey={`desmos:test:${attemptId}`} className="h-full w-full" />
            </section>
          )}

          {/* Right: question + options (or, for math, the whole self-contained stem) */}
          <section className={cn('min-h-0 overflow-y-auto px-8 py-6', isMath && !calcOpen && 'mx-auto w-full max-w-3xl')}>
            <div
              className="mb-4 flex items-center gap-3 px-1 py-1"
              style={{ backgroundColor: '#F1F2F7' }}
            >
              <span
                className="flex h-7 w-7 items-center justify-center text-[15px] font-bold text-white"
                style={{ backgroundColor: BB.navy }}
              >
                {current + 1}
              </span>
              <button
                onClick={toggleFlag}
                aria-pressed={!!flags[q.id]}
                className="flex items-center gap-1.5 text-[13px] hover:underline"
              >
                <span aria-hidden className="text-[13px]">
                  {flags[q.id] ? '🔖' : '🏳'}
                </span>
                {flags[q.id] ? 'Marked for Review' : 'Mark for Review'}
              </button>

              <button
                onClick={() => setEliminating((e) => !e)}
                aria-pressed={eliminating}
                title={eliminating ? 'Hide answer eliminator' : 'Show answer eliminator'}
                className={cn(
                  'ml-auto flex h-6 items-center rounded border px-1.5 text-[11px] font-bold',
                  eliminating ? 'border-[#324DC7] bg-[#324DC7] text-white' : 'border-[#5B6178]',
                )}
              >
                <span className="line-through">ABC</span>
              </button>
            </div>

            <div
              key={q.id}
              ref={stemHl.ref}
              onMouseUp={stemHl.onMouseUp}
              className={cn('dsat-text mb-5', !isMath && 'dsat-bold', tool && 'cursor-text')}
            >
              {stemContent}
            </div>

            {isSpr ? (
              <SprInput value={answers[q.id] ?? ''} onChange={typeAnswer} />
            ) : (
            <div role="radiogroup" aria-label="Answer choices" className="space-y-3">
              {options.map((opt) => {
                const selected = answers[q.id] === opt.letter;
                const isStruck = (struck[q.id] ?? []).includes(opt.letter);
                return (
                  <div key={opt.letter} className="flex items-center gap-2">
                    <button
                      role="radio"
                      aria-checked={selected}
                      onClick={() => select(opt.letter)}
                      className={cn(
                        'flex flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#324DC7]',
                        isStruck && 'opacity-45',
                      )}
                      style={{
                        borderColor: selected ? BB.blue : BB.optionBorder,
                        borderWidth: selected ? 2 : 1,
                        borderStyle: 'solid',
                        backgroundColor: selected ? '#EDF0FC' : '#fff',
                      }}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold"
                        style={{
                          borderColor: selected ? BB.blue : '#5B6178',
                          backgroundColor: selected ? BB.blue : 'transparent',
                          color: selected ? '#fff' : BB.ink,
                        }}
                      >
                        {opt.letter}
                      </span>
                      <span
                        className={cn('dsat-text', isStruck && 'line-through')}
                      >
                        {isMath ? <MathHtml html={opt.text} block={false} /> : <RichText>{opt.text}</RichText>}
                      </span>
                    </button>

                    {/* Per-option eliminator: a subtle cross, shown when the
                        eliminator is toggled on from the toolbar. Click to cross
                        the choice out, click again to restore it. */}
                    {eliminating && (
                      <button
                        onClick={() => toggleStrike(opt.letter)}
                        aria-label={`${isStruck ? 'Restore' : 'Cross out'} choice ${opt.letter}`}
                        aria-pressed={isStruck}
                        title={isStruck ? 'Restore answer' : 'Cross out answer'}
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#324DC7]',
                          isStruck
                            ? 'border-[#5B6178] bg-[#5B6178] text-white'
                            : 'border-transparent text-[#5B6178]/35 hover:border-[#5B6178] hover:text-[#5B6178]',
                        )}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          aria-hidden
                        >
                          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 rounded border border-[#C0392B] bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#C0392B]"
              >
                {error}
              </p>
            )}
          </section>
        </main>
      )}

      {exiting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="exit-title" className="dsat-text dsat-bold">
              Pause this test?
            </h2>
            <p className="dsat-text mt-2">
              {isTimed
                ? 'Your answers are saved and the timer stops here. Pick this sitting up again from Practice with the same time remaining — nothing is submitted or scored until you press Submit.'
                : 'Your answers are saved, so you can pick this sitting up again from Practice. Nothing is submitted or scored until you press Submit.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setExiting(false)}
                disabled={pause.isPending}
                className="rounded-full border border-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-[#1D2A5B] disabled:opacity-40"
              >
                Keep working
              </button>
              <button
                onClick={() => pause.mutate({ attemptId })}
                disabled={pause.isPending}
                className="rounded-full bg-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {pause.isPending ? 'Pausing…' : 'Pause & exit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer
        className="grid shrink-0 grid-cols-3 items-center px-6 py-2.5"
        style={{ backgroundColor: BB.chrome }}
      >
        <p className="truncate text-[13px] font-semibold">{attempt.data?.bankName}</p>

        <div className="flex justify-center">
          <button
            onClick={() => setReviewing((r) => !r)}
            className="rounded border border-[#5B6178] px-3 py-1 text-[13px] font-semibold hover:bg-white/60"
          >
            Question {current + 1} of {questions.length} <span aria-hidden>⌄</span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          {!reviewing && (
            <button
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
              className="rounded-full bg-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              Back
            </button>
          )}
          {reviewing || current === questions.length - 1 ? (
            <button
              onClick={doSubmit}
              disabled={submit.isPending}
              className="rounded-full bg-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {submit.isPending ? 'Submitting…' : `Submit ${answeredCount}/${questions.length}`}
            </button>
          ) : (
            <button
              onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
              className="rounded-full bg-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-white"
            >
              Next
            </button>
          )}
        </div>
      </footer>

      {/* SAT math reference sheet — opened from the header's "Reference". */}
      <SatReferenceSheet open={refOpen} onClose={() => setRefOpen(false)} />

      {/* ── Paused overlay ────────────────────────────────────────────
          Shown whenever the sitting loads paused (from Practice, or straight
          after Pause & Exit). The countdown is frozen behind it and only
          restarts once "Resume" flips the status back to in_progress. */}
      {paused && !submitted && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[#E7EAF4] px-6 text-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="paused-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white px-7 py-8 shadow-xl">
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-[22px]"
              style={{ backgroundColor: '#DCE1F1', color: BB.navy }}
              aria-hidden
            >
              ⏸
            </div>
            <h2 id="paused-title" className="dsat-text dsat-bold text-[19px]">
              Paused
            </h2>
            <p className="dsat-text mt-2 text-[#41454E]">
              You’ve answered {answeredCount} of {questions.length} question
              {questions.length === 1 ? '' : 's'}. Your work is saved.
            </p>

            <div className="my-5 flex items-center justify-center gap-6 border-y py-3" style={{ borderColor: BB.rule }}>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#5B6178]">Answered</p>
                <p className="text-[18px] font-semibold tabular-nums">
                  {answeredCount}/{questions.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#5B6178]">Time left</p>
                <p className="text-[18px] font-semibold tabular-nums">
                  {isTimed
                    ? mmss(Math.max(0, (timerSeconds ?? 0) - timeUsedSeconds))
                    : 'Untimed'}
                </p>
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <button
                onClick={() => router.push('/dashboard/practice')}
                disabled={resume.isPending}
                className="rounded-full border border-[#1D2A5B] px-5 py-2 text-[13px] font-semibold text-[#1D2A5B] disabled:opacity-40"
              >
                Later
              </button>
              <button
                onClick={() => resume.mutate({ attemptId })}
                disabled={resume.isPending}
                className="rounded-full bg-[#1D2A5B] px-6 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {resume.isPending ? 'Resuming…' : 'Resume'}
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-[12px] text-[#C0392B]">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Freeze + auto-submit overlay ──────────────────────────────
          Covers the whole screen the instant time runs out (or on manual
          submit), so nothing underneath can be clicked or typed while the
          sitting is graded. If the submit fails, it stays up with a retry —
          the student never gets back to answering past the deadline. */}
      {(submitted || timeExpired) && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-white/95 px-6 text-center backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-labelledby="submit-overlay-title"
        >
          <div className="w-full max-w-sm">
            {submitted || !error ? (
              <>
                <div
                  className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border-[3px] border-[#1D2A5B] border-t-transparent"
                  aria-hidden
                />
                <h2 id="submit-overlay-title" className="dsat-text dsat-bold text-[18px]">
                  {timeExpired ? 'Time’s up' : 'Submitting'}
                </h2>
                <p className="dsat-text mt-2">
                  {timeExpired
                    ? 'Your time has ended. Submitting your answers…'
                    : 'Submitting your test…'}
                </p>
              </>
            ) : (
              <>
                <h2 id="submit-overlay-title" className="dsat-text dsat-bold text-[18px] text-[#C0392B]">
                  Couldn’t submit
                </h2>
                <p className="dsat-text mt-2">
                  {error ?? 'Something went wrong.'} Your time is up, so your answers are final.
                </p>
                <button
                  onClick={doSubmit}
                  className="mt-5 rounded-full bg-[#1D2A5B] px-6 py-2 text-[13px] font-semibold text-white"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Bluebook's question navigator: every question as a tile — filled when
 * answered, dashed outline when not, flagged ones marked.
 */
function ReviewPanel({
  title,
  questions,
  answers,
  flags,
  onJump,
  onClose,
}: {
  title: string;
  questions: { id: string; external_id?: string | null }[];
  answers: Record<string, string | null>;
  flags: Record<string, boolean>;
  onJump: (index: number) => void;
  onClose: () => void;
}) {
  const unanswered = questions.filter((q) => !answers[q.id]).length;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="dsat-text dsat-bold text-center">{title}</h2>
        <p className="dsat-text mt-1 text-center">
          {unanswered === 0
            ? 'All questions answered.'
            : `${unanswered} unanswered question${unanswered === 1 ? '' : 's'}.`}
        </p>

        <div
          className="mx-auto mt-6 flex max-w-md items-center justify-center gap-6 border-y py-2 text-[12px]"
          style={{ borderColor: BB.rule }}
        >
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 border"
              style={{ backgroundColor: BB.navy, borderColor: BB.navy }}
            />
            Answered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 border border-dashed" style={{ borderColor: '#5B6178' }} />
            Unanswered
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden>🔖</span>
            For Review
          </span>
        </div>

        <div className="mt-6 grid grid-cols-8 gap-3 sm:grid-cols-10">
          {questions.map((q, i) => {
            const answered = !!answers[q.id];
            const flagged = !!flags[q.id];
            return (
              <button
                key={q.id}
                onClick={() => onJump(i)}
                title={q.external_id ? `ID ${q.external_id}` : undefined}
                aria-label={`Question ${i + 1}${answered ? ', answered' : ', unanswered'}${flagged ? ', marked for review' : ''}`}
                className="relative flex aspect-square items-center justify-center border text-[14px] font-semibold tabular-nums"
                style={{
                  backgroundColor: answered ? BB.navy : 'transparent',
                  color: answered ? '#fff' : BB.ink,
                  borderColor: answered ? BB.navy : '#5B6178',
                  borderStyle: answered ? 'solid' : 'dashed',
                }}
              >
                {i + 1}
                {flagged && (
                  <span aria-hidden className="absolute -right-1.5 -top-2.5 text-[15px] leading-none">
                    🔖
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <button
            onClick={onClose}
            className="rounded-full border px-6 py-1.5 text-[13px] font-semibold"
            style={{ borderColor: BB.navy, color: BB.navy }}
          >
            Go to Question
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Student-produced-response grid-in: a free-text field, mirroring Bluebook's
 * answer box. The typed value is saved verbatim and graded server-side.
 */
function SprInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="max-w-xs">
      <label className="dsat-text mb-2 block text-[13px] font-semibold">Answer</label>
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer"
        className="dsat-text w-full rounded-lg border px-4 py-3 outline-none focus-visible:ring-2"
        style={{ borderColor: BB.optionBorder }}
      />
      <p className="mt-2 text-[12px] text-[#5B6178]">
        Enter a number. Fractions like 3/4 and decimals like 0.75 are both accepted.
      </p>
    </div>
  );
}
