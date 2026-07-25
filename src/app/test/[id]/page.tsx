'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';
import { QuestionFigure } from '@/components/question-figure';
import { RichText } from '@/components/rich-text';

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
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [timerHidden, setTimerHidden] = useState(false);
  const [exiting, setExiting] = useState(false);
  const startedAt = useRef<number>(Date.now());

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

  // When the visible question changes, flush the time spent on the one being
  // left so its dwell time is persisted even if the student never re-picks.
  useEffect(() => {
    const nextQid = questions[current]?.id ?? null;
    const leaving = prevQid.current;
    if (leaving && leaving !== nextQid) {
      save.mutate({ attemptId, questionId: leaving, timeSpentMs: accumulateTime(leaving) });
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

  const doSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    // Flush the time spent on the question currently on screen before grading.
    const leaving = prevQid.current;
    if (leaving) {
      save.mutate({ attemptId, questionId: leaving, timeSpentMs: accumulateTime(leaving) });
    }
    const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
    submit.mutate({ attemptId, timeUsedSeconds: elapsed });
  }, [submitted, submit, attemptId, save, accumulateTime]);

  // Countdown, mirroring Bluebook's m:ss readout in the header.
  const timerSeconds = attempt.data?.timerSeconds ?? null;
  const isTimed = Boolean(attempt.data?.timed && timerSeconds);
  useEffect(() => {
    if (!isTimed || timerSeconds === null) return;
    setRemaining(timerSeconds);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return r;
        if (r <= 1) {
          clearInterval(id);
          setTimeout(doSubmit, 0);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isTimed, timerSeconds, doSubmit]);

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
  const answeredCount = questions.filter((qq) => answers[qq.id]).length;
  const options = ((q.options as QuestionOption[]) ?? []).map((o, i) => ({
    letter: o.letter ?? LETTERS[i],
    text: o.text,
  }));

  const select = (letter: string) => {
    const next = answers[q.id] === letter ? null : letter;
    setAnswers((prev) => ({ ...prev, [q.id]: next }));
    save.mutate({
      attemptId,
      questionId: q.id,
      selectedAnswer: next as 'A' | 'B' | 'C' | 'D' | null,
      timeSpentMs: accumulateTime(q.id),
    });
  };

  const toggleFlag = () => {
    const next = !flags[q.id];
    setFlags((prev) => ({ ...prev, [q.id]: next }));
    save.mutate({ attemptId, questionId: q.id, flagged: next, timeSpentMs: accumulateTime(q.id) });
  };

  const toggleStrike = (letter: string) => {
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
          <h1 className="text-[15px] font-bold leading-tight">Section 1: Reading and Writing</h1>
          <button
            onClick={() => setExiting(true)}
            className="mt-0.5 flex items-center gap-1.5 rounded border border-[#5B6178] px-2 py-0.5 text-[12px] font-semibold hover:bg-white/60"
          >
            <span aria-hidden>←</span> Save &amp; Exit
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
          <span className="flex flex-col items-center gap-0.5 opacity-50">
            <span aria-hidden className="text-[15px]">✎</span>
            Highlights &amp; Notes
          </span>
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
        /* ── Split panes ───────────────────────────────────────── */
        <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* Left: stimulus */}
          <section
            className="min-h-0 overflow-y-auto px-8 py-6 md:border-r"
            style={{ borderColor: '#6B7280' }}
          >
            <QuestionFigure
              url={(q as { visual_url?: string | null }).visual_url}
              description={(q as { visual_data?: string | null }).visual_data}
            />
            {q.passage && (
              <p className="dsat-text whitespace-pre-line">
                <RichText>{q.passage}</RichText>
              </p>
            )}
          </section>

          {/* Right: question + options */}
          <section className="min-h-0 overflow-y-auto px-8 py-6">
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
                title="Cross out answer choices"
                className={cn(
                  'ml-auto flex h-6 items-center rounded border px-1.5 text-[11px] font-bold',
                  eliminating ? 'border-[#324DC7] bg-[#324DC7] text-white' : 'border-[#5B6178]',
                )}
              >
                <span className="line-through">ABC</span>
              </button>
            </div>

            <p className="dsat-text dsat-bold mb-5">
              <RichText>{q.question_text}</RichText>
            </p>

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
                        <RichText>{opt.text}</RichText>
                      </span>
                    </button>

                    {/* Bluebook's per-option eliminator, shown only in ABC mode */}
                    {eliminating && (
                      <button
                        onClick={() => toggleStrike(opt.letter)}
                        aria-label={`${isStruck ? 'Restore' : 'Cross out'} choice ${opt.letter}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#5B6178] text-[11px] font-semibold"
                      >
                        <span className={cn(isStruck && 'line-through')}>{opt.letter}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

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
              Leave this test?
            </h2>
            <p className="dsat-text mt-2">
              Your answers are saved as you go, so you can pick this sitting up again from
              Practice. Nothing is submitted or scored until you press Submit.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setExiting(false)}
                className="rounded-full border border-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-[#1D2A5B]"
              >
                Keep working
              </button>
              <button
                onClick={() => router.push('/dashboard/practice')}
                className="rounded-full bg-[#1D2A5B] px-5 py-1.5 text-[13px] font-semibold text-white"
              >
                Save &amp; exit
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
    </div>
  );
}

/**
 * Bluebook's question navigator: every question as a tile — filled when
 * answered, dashed outline when not, flagged ones marked.
 */
function ReviewPanel({
  questions,
  answers,
  flags,
  onJump,
  onClose,
}: {
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
        <h2 className="dsat-text dsat-bold text-center">
          Section 1: Reading and Writing
        </h2>
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
                  <span aria-hidden className="absolute -right-1 -top-2 text-[11px]">
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
