'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { UploadBankModal } from '@/components/upload-bank-modal';
import { ModuleBuilderModal } from '@/components/module-builder-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { domainLabel, formatRelative } from '@/lib/labels';

const CARD_TONES = [
  { bg: 'bg-amber-tint', fill: 'bg-amber' },
  { bg: 'bg-violet-tint', fill: 'bg-violet' },
  { bg: 'bg-green-tint', fill: 'bg-green' },
  { bg: 'bg-blue-tint', fill: 'bg-blue' },
] as const;

interface Bank {
  id: string;
  name: string;
  description: string | null;
  total_questions: number | null;
  is_default: boolean;
  created_at: string;
  counts: { verified: number; needs_review: number; skipped: number };
  /** Questions in this bank the user has already answered. */
  attempted: number;
}

interface ModuleRow {
  id: string;
  name: string;
  format: 'dsat' | 'custom';
  totalQuestions: number;
  plan: Record<string, number>;
  createdAt: string;
  sourceBankNames: string[];
}

/** What the config modal is starting: a single bank or a composed module. */
type Configuring =
  | { kind: 'bank'; bank: Bank }
  | { kind: 'module'; module: ModuleRow };

const MODE_TABS = [
  { value: 'timed' as const, label: 'Timed' },
  { value: 'untimed' as const, label: 'Untimed' },
];

/** The top-level split: startable question banks vs. your module record. */
type PracticeTab = 'sets' | 'modules';
const PRACTICE_TABS = [
  { value: 'sets' as const, label: 'Practice sets' },
  { value: 'modules' as const, label: 'Modules' },
];

/** m:ss from a whole number of seconds. */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Score bands for the module "report cards" — the colour is the whole point:
 * a finished module reads its grade at a glance, and the palette (green→blue→
 * amber→red) is distinct from the banks' cycling pastel tones.
 */
const SCORE_BANDS = [
  { min: 80, tint: 'bg-green-tint', ring: '#3E9E6E', chip: 'text-green' },
  { min: 65, tint: 'bg-blue-tint', ring: '#3D6BE0', chip: 'text-blue' },
  { min: 50, tint: 'bg-amber-tint', ring: '#E2A63D', chip: 'text-amber' },
  { min: -1, tint: 'bg-miss-tint', ring: '#C7524A', chip: 'text-miss' },
] as const;
const bandFor = (score: number | null) =>
  SCORE_BANDS.find((b) => (score ?? 0) >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];

/** A domain's accuracy → a raw hex, for inline SVG rings and bar fills. */
const accuracyHex = (correct: number, total: number): string => {
  const pct = total > 0 ? (correct / total) * 100 : 0;
  return pct >= 80 ? '#3E9E6E' : pct >= 50 ? '#E2A63D' : '#C7524A';
};

/** A circular score dial — the signature element of a module report card. */
function ScoreDial({ percent, color }: { percent: number; color: string }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#17181C" strokeOpacity="0.08" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - clamped / 100)}
        transform="rotate(-90 32 32)"
      />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#17181C"
        style={{ fontSize: '15px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

/**
 * A compact domain gauge — a small ring with the accuracy % inside and a short
 * label beneath. A row of these shows every domain's score at a glance without
 * needing to expand the card.
 */
function MiniRing({
  percent,
  color,
  label,
  sub,
}: {
  percent: number;
  color: string;
  label: string;
  sub?: string;
}) {
  const r = 15;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex w-14 flex-col items-center gap-1 text-center">
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="#17181C" strokeOpacity="0.08" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          transform="rotate(-90 22 22)"
        />
        <text
          x="22"
          y="23"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#17181C"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          {Math.round(pct)}
        </text>
      </svg>
      <span className="w-full truncate text-[11px] font-medium text-ink-700" title={label}>
        {label}
      </span>
      {sub && <span className="text-[10px] text-ink-400 tabular-nums">{sub}</span>}
    </div>
  );
}

/** The subset of a listed attempt a module report card needs. */
interface ModuleAttempt {
  id: string;
  bankName: string;
  scorePercent: number | null;
  correctCount: number | null;
  totalQuestions: number | null;
  timeUsedSeconds: number | null;
  timed: boolean;
  startedAt: string;
  submittedAt: string | null;
  flaggedCount: number;
  sections: { domain: string; correct: number; total: number; timeMs: number }[];
}

/** A compact labelled statistic for the report-card footer. */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 truncate text-small font-semibold text-ink-900 tabular-nums">{value}</p>
      {hint && <p className="truncate text-[10px] text-ink-500 tabular-nums">{hint}</p>}
    </div>
  );
}

/**
 * A large, stacked "report card" for a finished module — a colored rail on the
 * left carries the grade at a glance (score dial + correct count + date), and the
 * body shows the useful summary: accuracy rings per domain, a stat row (time,
 * pace, flagged, slowest domain), and a text link into the full analysis.
 */
function ModuleReportCard({ attempt: a }: { attempt: ModuleAttempt }) {
  const score = a.scorePercent;
  const band = bandFor(score);
  const when = a.submittedAt ?? a.startedAt;

  // Derived, genuinely useful metrics for the footer.
  const totalQ = a.totalQuestions ?? 0;
  const avgPerQ =
    totalQ > 0 && a.timeUsedSeconds != null ? Math.round(a.timeUsedSeconds / totalQ) : null;
  // The domain the sitting spent the most time-per-question on — surfaced from
  // the per-question timings we record on every answer.
  const timed = a.sections.filter((s) => s.timeMs > 0 && s.total > 0);
  const slowest = timed.length
    ? timed.reduce((m, s) => (s.timeMs / s.total > m.timeMs / m.total ? s : m))
    : null;
  const slowestAvgSec = slowest ? Math.round(slowest.timeMs / slowest.total / 1000) : null;

  return (
    <div className="rounded-card border border-line bg-surface p-2.5 transition-shadow hover:shadow-lift">
      <div className="flex gap-4">
        {/* Inset colored rail — padded in on all sides so it floats inside the
            card rather than touching the edges. The score ring is the sole focus. */}
        <div className={cn('flex w-28 shrink-0 flex-col items-center gap-3 rounded-xl p-4 text-center sm:w-36', band.tint)}>
          <div className="rounded-xl bg-white p-2.5 shadow-sm">
            {score != null ? (
              <ScoreDial percent={score} color={band.ring} />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center text-h2 font-semibold text-ink-400">—</div>
            )}
          </div>
          <div>
            <p className="text-body font-semibold text-ink-900 tabular-nums">
              {a.correctCount ?? 0}/{a.totalQuestions ?? 0}
            </p>
            <p className="text-micro text-ink-500">correct</p>
          </div>
          <div className="mt-auto">
            <p className="text-micro text-ink-400">Completed</p>
            <p className="text-small font-medium text-ink-900">{formatRelative(when)}</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-w-0 flex-1 flex-col py-2 pr-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className={cn('inline-flex items-center gap-1 rounded-pill bg-sunken px-2 py-0.5 text-[11px] font-semibold', band.chip)}>
                <Icon name="grid-alt" className="text-[10px]" />
                Module
              </span>
              <h3 className="mt-1.5 truncate text-h3 font-semibold text-ink-900">{a.bankName}</h3>
              <p className="mt-0.5 text-micro text-ink-500 tabular-nums">
                {a.totalQuestions ?? '—'} questions
                {a.timed && a.timeUsedSeconds != null && ` · ${mmss(a.timeUsedSeconds)}`} ·{' '}
                {formatRelative(when)}
              </p>
            </div>

            {/* Text link into the full per-question analysis — the label
                underlines and the arrow nudges on hover, like the banks' "View log". */}
            <Link
              href={`/test/${a.id}/results`}
              className="group inline-flex shrink-0 items-center gap-1 rounded-sm text-micro font-medium text-blue underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
            >
              <span className="group-hover:underline">View full analysis</span>
              <Icon name="arrow-right" className="text-[10px] transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Domain accuracy at a glance — a compact ring per domain, percentage
              inside and correct/total below. No expand needed. */}
          {a.sections.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
              {a.sections.map((s) => (
                <MiniRing
                  key={s.domain}
                  percent={s.total > 0 ? (s.correct / s.total) * 100 : 0}
                  color={accuracyHex(s.correct, s.total)}
                  label={domainLabel(s.domain).split(' ')[0]}
                  sub={`${s.correct}/${s.total}`}
                />
              ))}
            </div>
          )}

          {/* Footer stat row — time, pace, focus. Even space above and below the
              divider (mt matches pt) keeps it visually balanced under the rings. */}
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-6 sm:grid-cols-4">
            <Stat
              label="Total time"
              value={a.timed && a.timeUsedSeconds != null ? mmss(a.timeUsedSeconds) : '—'}
            />
            <Stat label="Per question" value={avgPerQ != null ? `${avgPerQ}s` : '—'} />
            <Stat label="Flagged" value={a.flaggedCount} />
            <Stat
              label="Most time on"
              value={slowest ? domainLabel(slowest.domain).split(' ')[0] : '—'}
              hint={slowestAvgSec != null ? `${slowestAvgSec}s / question` : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sort banks newest-first and split them into rolling time buckets, so a long
 * list reads as "what I added recently" rather than one flat wall. Empty
 * buckets drop out, and everything past a month collapses into "Earlier".
 */
function groupBanksByTime(banks: Bank[]): { label: string; banks: Bank[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const buckets: { label: string; since: number }[] = [
    { label: 'Today', since: startOfToday },
    { label: 'This week', since: startOfToday - 7 * DAY },
    { label: 'This month', since: startOfToday - 30 * DAY },
    { label: 'Earlier', since: Number.NEGATIVE_INFINITY },
  ];
  const groups = buckets.map((b) => ({ label: b.label, banks: [] as Bank[] }));
  const sorted = [...banks].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const bank of sorted) {
    const t = new Date(bank.created_at).getTime();
    const idx = buckets.findIndex((b) => t >= b.since);
    groups[idx].banks.push(bank);
  }
  return groups.filter((g) => g.banks.length > 0);
}

function PracticeInner() {
  const router = useRouter();
  const search = useSearchParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const banks = useQuery(trpc.questionBanksManagement.list.queryOptions());
  const modules = useQuery(trpc.modulesManagement.list.queryOptions());
  const attempts = useQuery(trpc.tests.listAttempts.queryOptions({ limit: 50 }));

  const [uploadOpen, setUploadOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [configuring, setConfiguring] = useState<Configuring | null>(null);
  const [mode, setMode] = useState<'timed' | 'untimed'>('timed');
  const [minutes, setMinutes] = useState(20);
  const [seconds, setSeconds] = useState(0);
  const [count, setCount] = useState(8);
  const [excludeSeen, setExcludeSeen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Bank | null>(null);
  const [deletingModule, setDeletingModule] = useState<ModuleRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  type AttemptRow = NonNullable<typeof attempts.data>[number];
  const [tab, setTab] = useState<PracticeTab>('sets');
  const [deletingAttempt, setDeletingAttempt] = useState<AttemptRow | null>(null);

  // Deep link from onboarding's "Upload a paper", and from a ?tab= selection.
  useEffect(() => {
    if (search.get('upload') === '1') setUploadOpen(true);
    if (search.get('tab') === 'modules') setTab('modules');
  }, [search]);

  const removeAttempt = useMutation(
    trpc.tests.deleteAttempt.mutationOptions({
      onSuccess: async () => {
        setDeletingAttempt(null);
        await queryClient.invalidateQueries(trpc.tests.listAttempts.queryFilter());
      },
      onError: (e) => setDeleteError(e.message),
    }),
  );

  const start = useMutation(
    trpc.tests.start.mutationOptions({
      onSuccess: (res) => {
        setConfiguring(null);
        router.push(`/test/${res.attemptId}`);
      },
      onError: (e) => setStartError(e.message),
    }),
  );

  const remove = useMutation(
    trpc.questionBanksManagement.delete.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await queryClient.invalidateQueries();
      },
      onError: (e) => setDeleteError(e.message),
    }),
  );

  const removeModule = useMutation(
    trpc.modulesManagement.delete.mutationOptions({
      onSuccess: async () => {
        setDeletingModule(null);
        await queryClient.invalidateQueries();
      },
      onError: (e) => setDeleteError(e.message),
    }),
  );

  const begin = () => {
    if (!configuring) return;
    setStartError(null);
    const common = {
      timed: mode === 'timed',
      // Minutes + seconds → total seconds, clamped to the server's bounds
      // (60s min, 10800s / 180min max).
      timerSeconds:
        mode === 'timed'
          ? Math.max(60, Math.min(10800, minutes * 60 + seconds))
          : undefined,
    };
    if (configuring.kind === 'bank') {
      start.mutate({ ...common, bankId: configuring.bank.id, questionCount: count, excludeSeen });
    } else {
      // A module's length and mix are fixed by its recipe.
      start.mutate({ ...common, moduleId: configuring.module.id });
    }
  };

  const list = (banks.data ?? []) as Bank[];
  const moduleList = (modules.data ?? []) as ModuleRow[];
  // Sittings still open — paused, or in progress — surfaced up top so a person
  // can pick up exactly where they left off.
  const resumable = (attempts.data ?? []).filter((a) => a.status !== 'submitted');
  // Completed *module* sittings (composed modules + ad-hoc exam modules, which
  // have no bank), newest first — the record you analyse in the Modules tab.
  const moduleAttempts = (attempts.data ?? []).filter(
    (a) => a.status === 'submitted' && (a.isModule || a.bankId === null),
  );
  const configBank = configuring?.kind === 'bank' ? configuring.bank : null;
  const pool = configBank
    ? excludeSeen
      ? Math.max(1, configBank.counts.verified - configBank.attempted)
      : configBank.counts.verified
    : 1;
  const max = Math.max(1, pool);

  // Group the banks into time buckets, and pin each bank's card tone by its
  // position in the flattened, date-sorted order so colors stay varied and
  // stable regardless of how the buckets fall.
  const bankGroups = groupBanksByTime(list);
  const toneOf = new Map(
    bankGroups.flatMap((g) => g.banks).map((b, i) => [b.id, CARD_TONES[i % CARD_TONES.length]]),
  );

  const renderBankCard = (bank: Bank, tone: (typeof CARD_TONES)[number]) => {
    const verified = bank.counts.verified;
    const pct = verified > 0 ? (bank.attempted / verified) * 100 : 0;

    return (
      <Card key={bank.id} interactive className={cn('border-transparent', tone.bg)}>
        <CardBody className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/70 px-2.5 py-1 text-micro font-medium text-ink-700 tabular-nums">
              <Icon name="book" className="text-micro" />
              {verified} question{verified === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-1.5">
              {bank.is_default && <Badge className="bg-white/70 text-ink-700">Built-in</Badge>}
              {bank.counts.needs_review > 0 && (
                <Badge tone="amber">{bank.counts.needs_review} to review</Badge>
              )}
              {/* Built-ins are shared, so they can't be deleted. */}
              {!bank.is_default && (
                <button
                  onClick={() => {
                    setDeleteError(null);
                    setDeleting(bank);
                  }}
                  aria-label={`Delete ${bank.name}`}
                  title="Delete bank"
                  className="rounded-control p-1.5 text-ink-500 transition-colors hover:bg-white/70 hover:text-miss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                >
                  <Icon name="trash-can" className="text-small" />
                </button>
              )}
            </div>
          </div>

          <div>
            <Link
              href={`/dashboard/practice/${bank.id}`}
              className="rounded-sm text-h3 font-semibold text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
            >
              {bank.name}
            </Link>
            <p className="mt-0.5 text-micro text-ink-500">
              Added {formatRelative(bank.created_at)}
              {bank.attempted > 0 && ` · ${bank.attempted} of ${verified} worked`}
            </p>
          </div>

          {bank.description && <p className="text-small text-ink-700">{bank.description}</p>}

          <div className="mt-auto flex items-center justify-between gap-4 pt-2">
            <div className="flex flex-1 items-center gap-2">
              {/* Progress = how much of the bank you've worked through */}
              <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-white/70">
                <div className={cn('h-full rounded-pill', tone.fill)} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-micro font-medium text-ink-700 tabular-nums">
                {bank.attempted}/{verified}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/practice/${bank.id}`}
                className="rounded-control px-2 py-1 text-micro font-medium text-ink-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
              >
                View log
              </Link>
              <Button
                size="sm"
                disabled={verified === 0}
                onClick={() => {
                  setCount(Math.min(8, verified));
                  setExcludeSeen(bank.attempted > 0 && bank.attempted < verified);
                  setConfiguring({ kind: 'bank', bank });
                }}
              >
                Start test
                <Icon name="arrow-right" className="text-small" />
              </Button>
            </div>
          </div>

          {verified === 0 && (
            <p className="text-micro text-ink-500">
              Nothing verified yet — review the flagged questions to make them sittable.
            </p>
          )}
        </CardBody>
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="Practice" description="Build a timed, full-length test from a bank — or compose a module from several.">
        <Button variant="ghost" onClick={() => setBuilderOpen(true)} disabled={list.length === 0}>
          <Icon name="grid-alt" className="text-small" />
          Build module
        </Button>
        <Button onClick={() => setUploadOpen(true)}>
          <Icon name="plus" className="text-small" />
          Create test
        </Button>
      </PageHeader>

      <p className="-mt-3 mb-6 text-small text-ink-500">
        Tests here run under a countdown, Bluebook-style — no feedback until you submit. To drill
        specific skills untimed, with the answer on demand after each question, use the{' '}
        <Link href="/dashboard/question-bank" className="font-medium text-blue hover:underline">
          Question Bank
        </Link>
        .
      </p>

      {/* Resume — open sittings (paused or in progress). Quiet single-line rows
          rather than loud cards, each with a discard control. */}
      {resumable.length > 0 && (
        <div className="mb-8">
          <p className="mb-2.5 text-micro font-semibold uppercase tracking-[0.08em] text-ink-400">
            Continue where you left off
          </p>
          <div className="space-y-2">
            {resumable.map((a) => {
              const isPaused = a.status === 'paused';
              const left =
                a.timed && a.timerSeconds != null
                  ? Math.max(0, a.timerSeconds - (a.timeUsedSeconds ?? 0))
                  : null;
              return (
                <div
                  key={a.id}
                  className="group flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 transition-colors hover:border-ink-400/40"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      isPaused ? 'bg-sunken text-ink-500' : 'bg-blue-tint text-blue',
                    )}
                    aria-hidden
                  >
                    <Icon name={isPaused ? 'timer' : 'pencil'} className="text-small" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-body font-medium text-ink-900">{a.bankName}</p>
                      <span className="shrink-0 rounded-pill bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                        {isPaused ? 'Paused' : 'In progress'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-micro text-ink-500 tabular-nums">
                      {left != null && `${mmss(left)} left · `}
                      {a.totalQuestions ?? '—'} question{a.totalQuestions === 1 ? '' : 's'} · started{' '}
                      {formatRelative(a.startedAt)}
                    </p>
                  </div>
                  <Button size="sm" className="shrink-0" onClick={() => router.push(`/test/${a.id}`)}>
                    Resume
                    <Icon name="arrow-right" className="text-small" />
                  </Button>
                  <button
                    onClick={() => {
                      setDeleteError(null);
                      setDeletingAttempt(a);
                    }}
                    aria-label={`Discard ${a.bankName}`}
                    title="Discard this sitting"
                    className="shrink-0 rounded-control p-1.5 text-ink-400 transition-colors hover:bg-sunken hover:text-miss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                  >
                    <Icon name="trash-can" className="text-small" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Tabs items={PRACTICE_TABS} value={tab} onChange={setTab} className="mb-6 w-full sm:w-auto" />

      {tab === 'sets' ? (
        /* ── Practice sets: your question banks, grouped by recency ────── */
        banks.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-card border border-line bg-sunken/50" />
            ))}
          </div>
        ) : bankGroups.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-tint text-blue">
                <Icon name="book" className="text-h3" />
              </span>
              <div>
                <h3 className="text-h3 font-semibold text-ink-900">No question banks yet</h3>
                <p className="mt-1 text-small text-ink-500">Upload a paper to turn it into a practice set.</p>
              </div>
              <Button onClick={() => setUploadOpen(true)}>
                <Icon name="plus" className="text-small" />
                Create test
              </Button>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-8">
            {bankGroups.map((group) => (
              <section key={group.label}>
                {/* Time-bucket eyebrow — a quiet divider, same language as the
                    rest of the dashboard's small labels. */}
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-400">
                    {group.label}
                  </h3>
                  <span className="text-micro text-ink-400 tabular-nums">{group.banks.length}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Reveal stagger className="grid gap-4 md:grid-cols-2">
                  {group.banks.map((bank) => renderBankCard(bank, toneOf.get(bank.id)!))}
                </Reveal>
              </section>
            ))}
          </div>
        )
      ) : (
        /* ── Modules: start a composed recipe, and analyse the ones done ── */
        <div className="space-y-8">
          {moduleList.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-400">Start a module</h3>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Reveal stagger className="grid gap-4 md:grid-cols-2">
                {moduleList.map((m) => (
                  <Card key={m.id} interactive className="border-blue/25 bg-blue-wash">
                    <CardBody className="flex h-full flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/70 px-2.5 py-1 text-micro font-medium text-ink-700 tabular-nums">
                          <Icon name="grid-alt" className="text-micro" />
                          {m.totalQuestions} questions
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge tone="blue">{m.format === 'dsat' ? 'DSAT' : 'Custom'}</Badge>
                          <button
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingModule(m);
                            }}
                            aria-label={`Delete ${m.name}`}
                            title="Delete module"
                            className="rounded-control p-1.5 text-ink-500 transition-colors hover:bg-white/70 hover:text-miss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                          >
                            <Icon name="trash-can" className="text-small" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-h3 font-semibold text-ink-900">{m.name}</h3>
                        <p className="mt-0.5 text-micro text-ink-500">
                          Combined from {m.sourceBankNames.join(', ')}
                        </p>
                      </div>

                      <p className="flex flex-wrap gap-1.5">
                        {Object.entries(m.plan).map(([domain, n]) => (
                          <Badge key={domain} tone="neutral">
                            {domainLabel(domain).split(' ')[0]} {n}
                          </Badge>
                        ))}
                      </p>

                      <div className="mt-auto flex items-center justify-between gap-4 pt-2">
                        <span className="text-micro text-ink-400">Added {formatRelative(m.createdAt)}</span>
                        <Button
                          size="sm"
                          onClick={() => {
                            setStartError(null);
                            setConfiguring({ kind: 'module', module: m });
                          }}
                        >
                          Start module
                          <Icon name="arrow-right" className="text-small" />
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </Reveal>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-400">
                Modules you’ve done
              </h3>
              {moduleAttempts.length > 0 && (
                <span className="text-micro text-ink-400 tabular-nums">{moduleAttempts.length}</span>
              )}
              <span className="h-px flex-1 bg-line" />
            </div>

            {attempts.isLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-40 animate-pulse rounded-card border border-line bg-sunken/50" />
                ))}
              </div>
            ) : moduleAttempts.length === 0 ? (
              <Card>
                <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-tint text-blue">
                    <Icon name="grid-alt" className="text-h3" />
                  </span>
                  <div>
                    <h3 className="text-h3 font-semibold text-ink-900">No modules yet</h3>
                    <p className="mt-1 max-w-sm text-small text-ink-500">
                      Build a hard, exam-style module from the{' '}
                      <Link href="/dashboard/question-bank" className="font-medium text-blue hover:underline">
                        Question Bank
                      </Link>
                      , or compose one from your banks. Finished modules show here for analysis.
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setBuilderOpen(true)} disabled={list.length === 0}>
                    <Icon name="grid-alt" className="text-small" />
                    Build module
                  </Button>
                </CardBody>
              </Card>
            ) : (
              <Reveal stagger className="space-y-4">
                {moduleAttempts.map((a) => (
                  <ModuleReportCard key={a.id} attempt={a} />
                ))}
              </Reveal>
            )}
          </section>
        </div>
      )}

      <UploadBankModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this bank?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate({ bankId: deleting.id })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete bank'}
              <Icon name="trash-can" className="text-small" />
            </Button>
          </>
        }
      >
        <p className="text-body text-ink-700">
          <strong className="font-medium text-ink-900">{deleting?.name}</strong> and its{' '}
          {deleting?.counts.verified ?? 0} questions will be removed, along with every sitting
          recorded against it. This can’t be undone.
        </p>
        {deleteError && (
          <p role="alert" className="mt-3 rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {deleteError}
          </p>
        )}
      </Modal>

      <Modal
        open={configuring !== null}
        onClose={() => setConfiguring(null)}
        title={configuring ? `Set up: ${configuring.kind === 'bank' ? configuring.bank.name : configuring.module.name}` : 'Set up'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfiguring(null)}>Cancel</Button>
            <Button onClick={begin} disabled={start.isPending}>
              {start.isPending ? 'Starting…' : 'Begin'}
              <Icon name="arrow-right" className="text-small" />
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-small font-medium text-ink-700">How do you want to sit it?</p>
            <Tabs items={MODE_TABS} value={mode} onChange={setMode} className="w-full" />
            <p className="mt-1.5 text-micro text-ink-400">
              {mode === 'timed'
                ? 'A countdown runs and auto-submits at zero.'
                : 'No countdown. Your elapsed time is still recorded.'}
            </p>
          </div>

          {mode === 'timed' && (
            <div>
              <p className="mb-1.5 text-small font-medium text-ink-700">Timer</p>
              <div className="flex items-start gap-3">
                <Input
                  aria-label="Timer minutes"
                  type="number"
                  min={0}
                  max={180}
                  value={minutes}
                  onChange={(e) => setMinutes(Math.max(0, Math.min(180, Math.floor(Number(e.target.value) || 0))))}
                  hint="min"
                  className="w-24"
                />
                <span className="pt-2 text-body text-ink-400">:</span>
                <Input
                  aria-label="Timer seconds"
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  onChange={(e) => setSeconds(Math.max(0, Math.min(59, Math.floor(Number(e.target.value) || 0))))}
                  hint="sec"
                  className="w-24"
                />
              </div>
              <p className="mt-1 text-micro text-ink-400">At least 1 minute, up to 3 hours.</p>
            </div>
          )}

          {/* A module's length and mix are fixed by its recipe; only banks pick a count. */}
          {configuring?.kind === 'module' ? (
            <div className="rounded-control bg-blue-wash px-3 py-2.5">
              <p className="text-small text-ink-700">
                {configuring.module.totalQuestions} questions, freshly drawn — anything you’ve
                already answered is skipped, so this won’t repeat.
              </p>
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(configuring.module.plan).map(([domain, n]) => (
                  <Badge key={domain} tone="blue">{domainLabel(domain).split(' ')[0]} {n}</Badge>
                ))}
              </p>
            </div>
          ) : (
            configBank && (
              <>
                <Input
                  label="Questions"
                  type="number"
                  min={1}
                  max={max}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
                  hint={excludeSeen ? `up to ${max} unseen` : `up to ${max}`}
                  className="max-w-[10rem]"
                />

                {configBank.attempted > 0 && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-control border border-line px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={excludeSeen}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setExcludeSeen(on);
                        const nextPool = on
                          ? Math.max(1, configBank.counts.verified - configBank.attempted)
                          : configBank.counts.verified;
                        setCount((c) => Math.min(c, nextPool));
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-blue"
                    />
                    <span>
                      <span className="block text-small font-medium text-ink-900">
                        Exclude questions I’ve already done
                      </span>
                      <span className="block text-micro text-ink-500 tabular-nums">
                        {configBank.counts.verified - configBank.attempted} of {configBank.counts.verified} still untouched
                      </span>
                    </span>
                  </label>
                )}

                {/* When exclusion leaves fewer than asked for, say so plainly
                    rather than quietly serving a shorter test. */}
                {excludeSeen && pool < 8 && (
                  <p className="rounded-control bg-amber-tint px-3 py-2 text-micro text-ink-700">
                    Only {pool} new question{pool === 1 ? '' : 's'} left in this bank. Reduce the
                    count, or turn exclusion off to reuse ones you’ve done.
                  </p>
                )}
              </>
            )
          )}

          {startError && (
            <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
              {startError}
            </p>
          )}

          <p className="rounded-control bg-blue-wash px-3 py-2 text-small text-ink-500">
            No feedback until you submit — answers lock in Bluebook style.
          </p>
        </div>
      </Modal>

      <ModuleBuilderModal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        banks={list}
        onCreated={() => setBuilderOpen(false)}
      />

      <Modal
        open={deletingModule !== null}
        onClose={() => setDeletingModule(null)}
        title="Delete this module?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingModule(null)}>Keep it</Button>
            <Button
              variant="danger"
              disabled={removeModule.isPending}
              onClick={() => deletingModule && removeModule.mutate({ moduleId: deletingModule.id })}
            >
              {removeModule.isPending ? 'Deleting…' : 'Delete module'}
              <Icon name="trash-can" className="text-small" />
            </Button>
          </>
        }
      >
        <p className="text-body text-ink-700">
          <strong className="font-medium text-ink-900">{deletingModule?.name}</strong> will be
          removed. The banks it draws from are untouched, and past sittings stay in your history.
        </p>
        {deleteError && (
          <p role="alert" className="mt-3 rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {deleteError}
          </p>
        )}
      </Modal>

      <Modal
        open={deletingAttempt !== null}
        onClose={() => setDeletingAttempt(null)}
        title="Discard this sitting?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingAttempt(null)}>Keep it</Button>
            <Button
              variant="danger"
              disabled={removeAttempt.isPending}
              onClick={() => deletingAttempt && removeAttempt.mutate({ attemptId: deletingAttempt.id })}
            >
              {removeAttempt.isPending ? 'Discarding…' : 'Discard sitting'}
              <Icon name="trash-can" className="text-small" />
            </Button>
          </>
        }
      >
        <p className="text-body text-ink-700">
          <strong className="font-medium text-ink-900">{deletingAttempt?.bankName}</strong> and any
          answers on it will be removed. This can’t be undone, but you can always start it again.
        </p>
        {deleteError && (
          <p role="alert" className="mt-3 rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {deleteError}
          </p>
        )}
      </Modal>
    </>
  );
}

export default function PracticePage() {
  return (
    <Suspense>
      <PracticeInner />
    </Suspense>
  );
}
