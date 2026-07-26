'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { RichText } from '@/components/rich-text';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { LoadingDots } from '@/components/ui/loading-dots';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { QuestionFigure } from '@/components/question-figure';
import { cn } from '@/lib/utils';
import { domainLabel } from '@/lib/labels';

/**
 * Domain-browse & custom set builder — modeled on the College Board Question
 * Bank's drill-down (domain → skill), deliberately with no chip/pill filters.
 *
 * Flow: Level 1 (domains + "randomize everything") → Level 2 (skills in a
 * domain, multi-select or "randomize this domain") → customize (count,
 * difficulty, order, exclude-done) → take in a split-pane exam window, one
 * question at a time with a per-question timer, each checked for instant
 * feedback. Every check records the attempt in the unified `answers` table (via
 * `questions.check`), feeding the same analytics as timed tests.
 */

const DOMAIN_ORDER = [
  'information_and_ideas',
  'craft_and_structure',
  'expression_of_ideas',
  'standard_english_conventions',
] as const;

const DOMAIN_TONES: Record<string, { bg: string; ring: string }> = {
  information_and_ideas: { bg: 'bg-amber-tint', ring: 'text-amber' },
  craft_and_structure: { bg: 'bg-violet-tint', ring: 'text-violet' },
  expression_of_ideas: { bg: 'bg-green-tint', ring: 'text-green' },
  standard_english_conventions: { bg: 'bg-blue-tint', ring: 'text-blue' },
};

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

type Scope =
  | { kind: 'all' }
  | { kind: 'domain'; domain: string }
  | { kind: 'skills'; domain: string; skills: string[] };

type Opt = { letter: string; text: string };
interface BuiltQuestion {
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
}

const EXCLUDE_ACTIVE_KEY = 'qb:excludeActive';

export default function QuestionBankPage() {
  const trpc = useTRPC();

  // "Exclude active Bluebook questions" — a sticky, page-wide preference. It
  // recomputes every section count and is carried into every set the user
  // builds, so once it's on they never practice a live question by accident.
  const [excludeActive, setExcludeActiveState] = useState(false);
  useEffect(() => {
    setExcludeActiveState(localStorage.getItem(EXCLUDE_ACTIVE_KEY) === '1');
  }, []);
  const setExcludeActive = (v: boolean) => {
    setExcludeActiveState(v);
    try {
      localStorage.setItem(EXCLUDE_ACTIVE_KEY, v ? '1' : '0');
    } catch {
      /* private mode / storage disabled — the toggle still works for the session */
    }
  };

  // Counts drive the drill-down and recompute whenever the toggle flips; the
  // customize step layers difficulty/exclusion on top and reports the pool size.
  const counts = useQuery(trpc.questions.domainCounts.queryOptions({ excludeActive }));

  const [domain, setDomain] = useState<string | null>(null); // null = Level 1
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [customize, setCustomize] = useState<Scope | null>(null);
  const [session, setSession] = useState<{ questions: BuiltQuestion[]; label: string } | null>(null);

  if (session) {
    return (
      <Taker
        questions={session.questions}
        scopeLabel={session.label}
        onExit={() => setSession(null)}
      />
    );
  }

  const domainData = domain ? counts.data?.domains.find((d) => d.domain === domain) : null;

  const scopeLabel = (s: Scope): string => {
    if (s.kind === 'all') return 'Mixed — all domains';
    if (s.kind === 'domain') return `${domainLabel(s.domain)} — all skills`;
    return `${domainLabel(s.domain)} — ${s.skills.length} skill${s.skills.length === 1 ? '' : 's'}`;
  };

  return (
    <>
      {domain === null ? (
        /* ── Level 1: domains ───────────────────────────────────────────── */
        <>
          <PageHeader
            title="Question Bank"
            description="Browse by domain and skill, then build a custom, untimed set — the answer on demand after each question."
          />

          <ExcludeActiveToggle value={excludeActive} onChange={setExcludeActive} />

          {counts.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-card border border-line bg-sunken/50" />
              ))}
            </div>
          ) : (
            <>
              <Reveal stagger className="grid gap-4 sm:grid-cols-2">
                {DOMAIN_ORDER.map((d) => {
                  const dc = counts.data?.domains.find((x) => x.domain === d);
                  const total = dc?.total ?? 0;
                  const tone = DOMAIN_TONES[d];
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={total === 0}
                      onClick={() => {
                        setSelectedSkills(new Set());
                        setDomain(d);
                      }}
                      className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue rounded-card disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Card interactive className={cn('border-transparent', tone.bg)}>
                        <CardBody className="flex items-center justify-between gap-4">
                          <div>
                            <h3 className="text-h3 font-semibold text-ink-900">{domainLabel(d)}</h3>
                            <p className="mt-0.5 text-small text-ink-600">
                              {dc?.skills.length ?? 0} skill{(dc?.skills.length ?? 0) === 1 ? '' : 's'}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-h2 font-semibold text-ink-900 tabular-nums">{total}</p>
                              <p className="text-micro text-ink-500">questions</p>
                            </div>
                            <Icon name="chevron-right" className={cn('text-body', tone.ring)} />
                          </div>
                        </CardBody>
                      </Card>
                    </button>
                  );
                })}
              </Reveal>

              {/* Distinct top-level "mix everything" option. */}
              <Card className="mt-4 border-blue/10 bg-blue-wash">
                <CardBody className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-h3 font-semibold text-ink-900">Randomize across everything</h3>
                    <p className="mt-0.5 text-small text-ink-600">
                      A fully mixed set drawn from all {counts.data?.total ?? 0} verified questions, not
                      scoped to one domain.
                    </p>
                  </div>
                  <Button
                    onClick={() => setCustomize({ kind: 'all' })}
                    disabled={(counts.data?.total ?? 0) === 0}
                  >
                    Build a set
                    <Icon name="arrow-right" className="text-small" />
                  </Button>
                </CardBody>
              </Card>
            </>
          )}
        </>
      ) : (
        /* ── Level 2: skills within a domain ────────────────────────────── */
        <>
          <button
            type="button"
            onClick={() => setDomain(null)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-control text-small font-medium text-ink-500 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
          >
            <Icon name="arrow-left" className="text-small" />
            All domains
          </button>

          <PageHeader
            title={domainLabel(domain)}
            description="Pick one or more skills to build from, or randomize the whole domain."
          />

          <div className="space-y-2">
            {(domainData?.skills ?? []).map((s) => {
              const on = selectedSkills.has(s.skill);
              return (
                <button
                  key={s.skill}
                  type="button"
                  onClick={() =>
                    setSelectedSkills((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.skill)) next.delete(s.skill);
                      else next.add(s.skill);
                      return next;
                    })
                  }
                  className={cn(
                    'flex w-full items-center justify-between gap-4 rounded-card border px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                    on ? 'border-blue bg-blue-tint' : 'border-line hover:border-ink-400/40',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                        on ? 'border-blue bg-blue text-white' : 'border-ink-400',
                      )}
                    >
                      {on && <Icon name="checkmark" className="text-micro" />}
                    </span>
                    <span className="text-body font-medium text-ink-900">{s.skill}</span>
                  </span>
                  <span className="text-small text-ink-500 tabular-nums">{s.total}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setCustomize({ kind: 'domain', domain })}>
              <Icon name="reload" className="text-small" />
              Randomize this domain
            </Button>
            <Button
              disabled={selectedSkills.size === 0}
              onClick={() =>
                setCustomize({ kind: 'skills', domain, skills: Array.from(selectedSkills) })
              }
            >
              Build from {selectedSkills.size} skill{selectedSkills.size === 1 ? '' : 's'}
              <Icon name="arrow-right" className="text-small" />
            </Button>
          </div>
        </>
      )}

      <CustomizeModal
        scope={customize}
        scopeLabel={customize ? scopeLabel(customize) : ''}
        excludeActive={excludeActive}
        onClose={() => setCustomize(null)}
        onBuilt={(questions, label) => {
          setSession({ questions, label });
          setCustomize(null);
        }}
      />
    </>
  );
}

/* ── Exclude-active toggle ───────────────────────────────────────────────── */

/**
 * The page-wide switch for hiding questions still live in Bluebook. A slim,
 * single-line bar — noticeable via a status dot + a soft green wash when on, but
 * far quieter than a full card. Its state is persisted and fed into every count
 * and every built set.
 */
function ExcludeActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label="Exclude active Bluebook questions"
      onClick={() => onChange(!value)}
      className={cn(
        'group mb-6 flex w-full items-center justify-between gap-4 rounded-control border px-4 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
        value ? 'border-green/10 bg-green-tint/50' : 'border-line bg-surface hover:border-ink-400/40',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full transition-colors',
            value ? 'bg-green' : 'bg-ink-400/60',
          )}
        />
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-small font-medium text-ink-900">Exclude active Bluebook questions</span>
          <span className="text-micro text-ink-500">
            {value ? 'On — showing only disclosed questions' : 'Hide questions still live in the practice tests in the official app'}
          </span>
        </span>
      </span>

      {/* Visual switch (the whole bar is the control) */}
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill transition-colors',
          value ? 'bg-green' : 'bg-ink-400/50 group-hover:bg-ink-400/70',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
            value ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

/* ── Customize modal ─────────────────────────────────────────────────────── */

function CustomizeModal({
  scope,
  scopeLabel,
  excludeActive,
  onClose,
  onBuilt,
}: {
  scope: Scope | null;
  scopeLabel: string;
  excludeActive: boolean;
  onClose: () => void;
  onBuilt: (questions: BuiltQuestion[], label: string) => void;
}) {
  const trpc = useTRPC();
  const [count, setCount] = useState(10);
  const [difficulties, setDifficulties] = useState<Set<Difficulty>>(new Set());
  const [excludeCompleted, setExcludeCompleted] = useState(false);
  const [order, setOrder] = useState<'random' | 'in_order'>('random');
  const [error, setError] = useState<string | null>(null);

  const build = useMutation(
    trpc.questions.buildCustomSet.mutationOptions({
      onSuccess: (res) => {
        onBuilt(res.questions as unknown as BuiltQuestion[], scopeLabel);
      },
      onError: (e) => setError(e.message),
    }),
  );

  const start = () => {
    if (!scope) return;
    setError(null);
    const diff = Array.from(difficulties);
    const base = {
      count,
      difficulty: diff.length ? diff : undefined,
      excludeCompleted,
      excludeActive,
      order,
    };
    if (scope.kind === 'all') build.mutate(base);
    else if (scope.kind === 'domain')
      build.mutate({ ...base, domains: [scope.domain] as ('information_and_ideas' | 'craft_and_structure' | 'expression_of_ideas' | 'standard_english_conventions')[] });
    else build.mutate({ ...base, skills: scope.skills });
  };

  return (
    <Modal
      open={scope !== null}
      onClose={onClose}
      title="Build your set"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start} disabled={build.isPending}>
            {build.isPending ? 'Building…' : 'Start set'}
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-control bg-sunken px-3 py-2 text-small text-ink-700">{scopeLabel}</p>

        <Input
          label="Questions"
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          hint="1–50"
          className="max-w-[10rem]"
        />

        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Difficulty</p>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((d) => {
              const on = difficulties.has(d.value);
              return (
                <label
                  key={d.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-small transition-colors',
                    on ? 'border-blue bg-blue-tint text-ink-900' : 'border-line text-ink-700',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDifficulties((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.value)) next.delete(d.value);
                        else next.add(d.value);
                        return next;
                      })
                    }
                    className="h-4 w-4 accent-blue"
                  />
                  {d.label}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-micro text-ink-400">Leave all unchecked for any difficulty.</p>
        </div>

        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Order</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'random', label: 'Random', hint: 'Shuffled draw' },
              { value: 'in_order', label: 'In order', hint: 'By question number' },
            ] as const).map((o) => {
              const on = order === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOrder(o.value)}
                  className={cn(
                    'rounded-control border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-blue bg-blue-tint' : 'border-line hover:border-ink-400/40',
                  )}
                >
                  <span className="block text-small font-medium text-ink-900">{o.label}</span>
                  <span className="block text-micro text-ink-500">{o.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-control border border-line px-3 py-2.5">
          <input
            type="checkbox"
            checked={excludeCompleted}
            onChange={(e) => setExcludeCompleted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue"
          />
          <span>
            <span className="block text-small font-medium text-ink-900">
              Exclude questions I’ve already done
            </span>
            <span className="block text-micro text-ink-500">
              Skips anything you’ve completed in a test or here.
            </span>
          </span>
        </label>

        {/* Active-question exclusion is a page-wide setting; this just confirms
            it's being applied to the set the user is about to build. */}
        {excludeActive && (
          <p className="flex items-center gap-2 rounded-control bg-green-tint px-3 py-2.5 text-small text-green">
            <Icon name="checkmark-circle" className="shrink-0 text-body" />
            Active Bluebook questions are excluded from this set.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
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

function Taker({
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

  const doCheck = async () => {
    if (st.result || !st.selected || checking) return; // an answer is required
    setChecking(true); // optimistic: show the loading indication right away
    const elapsed = st.timeMs + (Date.now() - startedAtRef.current);
    // Option letters come from the DB as plain strings; the API narrows to the
    // answer-letter union, and the taker only ever sets a real option letter.
    const selected = (st.selected ?? undefined) as 'A' | 'B' | 'C' | 'D' | undefined;

    // Reveal from the prefetched cache — instant when the answer is already in
    // (prefetched on select); otherwise this awaits the in-flight fetch.
    const revealed = await queryClient
      .ensureQueryData(trpc.questions.reveal.queryOptions({ questionId: q.id }))
      .finally(() => setChecking(false));
    const isCorrect = selected !== undefined ? selected === revealed.correctAnswer : null;
    setStates((s) => ({
      ...s,
      [q.id]: {
        ...(s[q.id] ?? EMPTY_STATE),
        timeMs: elapsed,
        result: { correctAnswer: revealed.correctAnswer, explanation: revealed.explanation, isCorrect },
      },
    }));

    // Persist the attempt in the background — grading is re-done server-side, so
    // the record is authoritative even though the UI already moved on.
    check.mutate({ questionId: q.id, selectedAnswer: selected, timeSpentMs: elapsed });
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

        {/* Per-question stopwatch */}
        <div className="flex items-center gap-2 rounded-full border border-[#E4DECF] bg-[#FFFDF8] px-4 py-1.5">
          <span className="h-2 w-2 rounded-full bg-[#3B5BDB]" />
          <span className="text-[15px] font-semibold tabular-nums text-[#23201B]">{fmtClock(liveMs)}</span>
        </div>

        <div className="flex items-center gap-4">
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

      {/* Split panes */}
      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        {/* Left: passage / figure */}
        <section className="min-h-0 overflow-y-auto border-[#ECE6DA] px-8 py-8 md:border-r md:px-10">
          <div className="mx-auto max-w-[38rem]">
            <QuestionFigure url={q.visual_url} description={q.visual_data} className="mb-4" />
            {q.passage ? (
              <>
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B0A891]">
                  Passage
                </p>
                <div className="rounded-2xl border border-[#EFE9DC] bg-[#FFFDF8] px-7 py-6 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                  <p className="qb-reading whitespace-pre-line text-[#2E2A23]">
                    <RichText>{q.passage}</RichText>
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

            {/* Question stem */}
            <p className="qb-reading mb-6 font-bold text-[#23201B]">
              <RichText>{q.question_text}</RichText>
            </p>

            {/* Options */}
            <div role="radiogroup" aria-label="Answer choices" className="space-y-3">
              {options.map((opt) => {
                const isSel = st.selected === opt.letter;
                const isCorrect = st.result?.correctAnswer === opt.letter;
                const isWrongPick = st.result && isSel && !isCorrect;
                return (
                  <button
                    key={opt.letter}
                    role="radio"
                    aria-checked={isSel}
                    disabled={!!st.result}
                    onClick={() => select(opt.letter)}
                    className={cn(
                      'group flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B5BDB]',
                      st.result
                        ? isCorrect
                          ? 'border-[#2F855A] bg-[#E6F4EC]'
                          : isWrongPick
                            ? 'border-[#C2415A] bg-[#FBE9EC]'
                            : 'border-[#E7E0D2] bg-white opacity-70'
                        : isSel
                          ? 'border-[#3B5BDB] bg-[#EEF2FF] shadow-[0_2px_0_rgba(59,91,219,0.18)]'
                          : 'border-[#E7E0D2] bg-white hover:border-[#C9C0AD] hover:bg-[#FFFDF8]',
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
                    <span className="qb-reading flex-1 text-[#2E2A23]">
                      <RichText>{opt.text}</RichText>
                    </span>
                  </button>
                );
              })}
            </div>

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
                    <p className="qb-reading whitespace-pre-line text-[#4A453B]">
                      <RichText>{st.result.explanation}</RichText>
                    </p>
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
