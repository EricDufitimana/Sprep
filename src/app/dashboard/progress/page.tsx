'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { color } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { accuracyTone, domainLabel, formatDate } from '@/lib/labels';
import { diagnosisLabel } from '@/lib/diagnosis';

type Analytics = NonNullable<ReturnType<typeof useAnalytics>['data']>;
function useAnalytics() {
  const trpc = useTRPC();
  return useQuery(trpc.progress.analytics.queryOptions());
}

const DIFF_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export default function ProgressPage() {
  const router = useRouter();
  const q = useAnalytics();

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="Progress" description="Your estimated score, where the points are, and whether you're on pace." />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-48 animate-pulse rounded-card bg-sunken/60 lg:col-span-2" />
          <div className="h-48 animate-pulse rounded-card bg-sunken/60" />
        </div>
      </>
    );
  }

  const data = q.data;
  if (!data || data.totals.answered === 0) {
    return (
      <>
        <PageHeader title="Progress" description="Your estimated score, where the points are, and whether you're on pace." />
        <EmptyState
          icon="bar-chart"
          title="Nothing to analyze yet"
          description="Answer some questions or sit a test — your estimated SAT score, weak spots, and pacing will appear here."
          action={
            <Button onClick={() => router.push('/dashboard/practice')}>
              Start practicing
              <Icon name="arrow-right" className="text-small" />
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Progress" description="Your estimated score, where the points are, and whether you're on pace.">
        <Button variant="ghost" onClick={() => router.push('/dashboard/practice')}>
          Practice
          <Icon name="arrow-right" className="text-small" />
        </Button>
      </PageHeader>

      {/* Hero: estimated score + goal/projection */}
      <Reveal className="grid gap-6 lg:grid-cols-3">
        <ScoreHero data={data} className="lg:col-span-2" />
        <GoalCard data={data} onSetGoal={() => router.push('/onboarding')} />
      </Reveal>

      {/* Score over time */}
      <Reveal delay={0.06} className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Estimated score over time</CardTitle>
            <span className="text-micro text-ink-400">R&amp;W · 200–800</span>
          </CardHeader>
          <CardBody>
            <TrendChart data={data} />
          </CardBody>
        </Card>
      </Reveal>

      {/* Diagnostics: where the points are */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Reveal delay={0.1}>
          <DifficultyCard data={data} />
        </Reveal>
        <Reveal delay={0.14}>
          <ErrorCard data={data} />
        </Reveal>
        <Reveal delay={0.18}>
          <PacingCard data={data} />
        </Reveal>
        <Reveal delay={0.22}>
          <DiagnosisCard data={data} />
        </Reveal>
      </div>

      {/* Domains + skills */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Reveal delay={0.26}>
          <DomainCard data={data} />
        </Reveal>
        <Reveal delay={0.3}>
          <SkillsCard data={data} />
        </Reveal>
      </div>

      {/* Practice mix */}
      <Reveal delay={0.34} className="mt-6">
        <PracticeMixCard data={data} />
      </Reveal>

      <p className="mt-6 text-center text-micro text-ink-400">
        Scores are an <span className="font-medium text-ink-500">estimate</span> from a Rasch (IRT) model over the
        difficulty of the questions you&apos;ve answered — not an official concordance.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Hero
 * ------------------------------------------------------------------ */

function ScoreHero({ data, className }: { data: Analytics; className?: string }) {
  const s = data.scaledScore;
  return (
    <Card className={cn('border-transparent bg-blue-wash', className)}>
      <CardBody className="flex h-full flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-small font-medium text-ink-500">Estimated R&amp;W score</p>
            <span className="rounded-pill bg-blue-tint px-2 py-0.5 text-micro font-medium text-blue">estimate</span>
          </div>
          {s ? (
            <>
              <p className="mt-1 text-score font-semibold text-ink-900 tabular-nums">{s.score}</p>
              <p className="text-body text-ink-500">
                likely range <span className="font-medium text-ink-700 tabular-nums">{s.low}–{s.high}</span> · from{' '}
                {s.sampleSize} questions
              </p>
              <p className="mt-1 text-micro text-ink-400">
                {s.domainsCovered < s.domainsTotal ? (
                  <>
                    balanced across {s.domainsCovered} of {s.domainsTotal} domains — practice the rest to complete it
                  </>
                ) : (
                  <>balanced across all {s.domainsTotal} domains by their SAT weighting</>
                )}
              </p>
            </>
          ) : (
            <p className="mt-2 max-w-xs text-body text-ink-500">
              Answer questions with a difficulty tag to unlock your estimate.
            </p>
          )}
        </div>

        {s && s.reachableDelta > 0 && (
          <div className="shrink-0 rounded-card bg-surface/70 px-4 py-3">
            <p className="text-micro font-medium uppercase tracking-wide text-ink-400">Within reach</p>
            <p className="mt-0.5 text-h1 font-semibold text-green tabular-nums">+{s.reachableDelta}</p>
            <p className="mt-0.5 max-w-[11rem] text-micro text-ink-500">
              points from cutting careless &amp; rushed misses ({s.reachableScore})
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function GoalCard({ data, onSetGoal }: { data: Analytics; onSetGoal: () => void }) {
  const target = data.target?.targetScore ?? null;
  const testDate = data.target?.testDate ?? null;
  const proj = data.projection;
  const current = data.scaledScore?.score ?? null;

  if (target == null && !testDate) {
    return (
      <Card className="flex h-full flex-col justify-center">
        <CardBody className="text-center">
          <Icon name="target" className="mx-auto text-h2 text-ink-400" />
          <p className="mt-2 text-body font-medium text-ink-900">Set a goal</p>
          <p className="mt-1 text-small text-ink-500">Add a target score and test date to track whether you&apos;re on pace.</p>
          <Button variant="ghost" className="mt-3" onClick={onSetGoal}>
            Set target
          </Button>
        </CardBody>
      </Card>
    );
  }

  const gap = target != null && current != null ? target - current : null;

  return (
    <Card className="h-full">
      <CardBody className="flex h-full flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-small text-ink-500">Target</p>
            <p className="text-h1 font-semibold text-ink-900 tabular-nums">{target ?? '—'}</p>
          </div>
          {gap != null && (
            <span
              className={cn(
                'rounded-pill px-2.5 py-1 text-small font-medium tabular-nums',
                gap <= 0 ? 'bg-green-tint text-green' : 'bg-blue-tint text-blue',
              )}
            >
              {gap <= 0 ? 'reached' : `${gap} to go`}
            </span>
          )}
        </div>

        {proj ? (
          <div className={cn('rounded-control px-3 py-2.5', proj.onPace ? 'bg-green-tint' : 'bg-amber-tint')}>
            <div className="flex items-center gap-1.5">
              <Icon name={proj.onPace ? 'checkmark-circle' : 'warning'} className={cn('text-small', proj.onPace ? 'text-green' : 'text-amber')} />
              <p className={cn('text-small font-semibold', proj.onPace ? 'text-green' : 'text-amber')}>
                {proj.onPace ? 'On pace' : 'Behind pace'}
              </p>
            </div>
            <p className="mt-1 text-small text-ink-700">
              Projected <span className="font-medium tabular-nums">{proj.projectedScore}</span> by test day
              {' · '}
              {proj.daysUntilTest} days left
            </p>
            {proj.requiredPerWeek != null && (
              <p className="mt-0.5 text-micro text-ink-500 tabular-nums">
                Trending {proj.pointsPerWeek >= 0 ? '+' : ''}{proj.pointsPerWeek}/wk · need {proj.requiredPerWeek > 0 ? '+' : ''}{proj.requiredPerWeek}/wk
              </p>
            )}
          </div>
        ) : (
          <p className="text-small text-ink-500">
            {testDate ? `Test on ${formatDate(testDate)}. ` : ''}
            Sit two timed tests to project your pace.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Trend chart — scaled score over time, with a dynamic axis + target line
 * ------------------------------------------------------------------ */

function TrendChart({ data }: { data: Analytics }) {
  const pts = data.trend.filter((t): t is typeof t & { scaledScore: number } => t.scaledScore != null);
  const target = data.target?.targetScore ?? null;

  if (pts.length === 0) {
    return <p className="py-10 text-center text-small text-ink-400">Sit a test to start the trend.</p>;
  }

  const width = 680;
  const height = 240;
  const pad = { top: 16, right: 12, bottom: 26, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = pts.map((p) => p.scaledScore).concat(target != null ? [target] : []);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const lo = Math.max(200, Math.floor((rawMin - 40) / 50) * 50);
  const hi = Math.min(800, Math.ceil((rawMax + 40) / 50) * 50);
  const span = Math.max(50, hi - lo);

  const x = (i: number) => pad.left + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - lo) / span) * innerH;

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.scaledScore).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;
  const gridVals = [lo, lo + span / 2, hi];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Estimated score over time" className="w-full">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color.blue.DEFAULT} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color.blue.DEFAULT} stopOpacity={0} />
        </linearGradient>
      </defs>

      {gridVals.map((g) => (
        <g key={g}>
          <line x1={pad.left} x2={width - pad.right} y1={y(g)} y2={y(g)} stroke={color.line} strokeWidth={1} />
          <text x={pad.left - 8} y={y(g) + 3} textAnchor="end" fontSize={10} fill={color.ink[400]}>
            {Math.round(g)}
          </text>
        </g>
      ))}

      {target != null && target >= lo && target <= hi && (
        <g>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(target)}
            y2={y(target)}
            stroke={color.green.DEFAULT}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <text x={width - pad.right} y={y(target) - 5} textAnchor="end" fontSize={10} fill={color.green.DEFAULT}>
            target {target}
          </text>
        </g>
      )}

      {pts.length > 1 && <path d={area} fill="url(#trendFill)" />}
      {pts.length > 1 && (
        <path d={line} fill="none" stroke={color.blue.DEFAULT} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {pts.map((p, i) => (
        <circle key={p.attemptId} cx={x(i)} cy={y(p.scaledScore)} r={4} fill={color.surface} stroke={color.blue.DEFAULT} strokeWidth={2} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Diagnostic cards
 * ------------------------------------------------------------------ */

function DifficultyCard({ data }: { data: Analytics }) {
  const rows = data.byDifficulty.filter((d) => d.total > 0);
  const hard = data.byDifficulty.find((d) => d.key === 'hard');
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Accuracy by difficulty</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-small text-ink-400">No difficulty data yet.</p>
        ) : (
          <>
            {data.byDifficulty.map((d) => (
              <div key={d.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-small text-ink-700">{DIFF_LABEL[d.key]}</span>
                  <span className="text-small font-medium text-ink-900 tabular-nums">
                    {d.total === 0 ? '—' : `${d.accuracyPercent}%`}
                  </span>
                </div>
                <ProgressBar value={d.accuracyPercent} tone={accuracyTone(d.accuracyPercent)} />
                <p className="mt-0.5 text-micro text-ink-400 tabular-nums">{d.correct}/{d.total}</p>
              </div>
            ))}
            {hard && hard.total >= 3 && (
              <p className="text-micro text-ink-500">
                Hard-question accuracy is what separates the top score bands — that&apos;s your ceiling.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ErrorCard({ data }: { data: Analytics }) {
  const { total, careless, knowledge } = data.errors;
  const carelessPct = total === 0 ? 0 : Math.round((careless / total) * 100);
  const reach = data.scaledScore?.reachableDelta ?? 0;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Why you&apos;re losing points</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {total === 0 ? (
          <p className="text-small text-ink-400">No misses to analyze — yet.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-pill bg-sunken">
              <div className="bg-amber" style={{ width: `${carelessPct}%` }} />
              <div className="bg-miss" style={{ width: `${100 - carelessPct}%` }} />
            </div>
            <div className="flex justify-between text-small">
              <span className="flex items-center gap-1.5 text-ink-700">
                <span className="h-2.5 w-2.5 rounded-full bg-amber" /> Careless / rushed
                <span className="font-medium text-ink-900 tabular-nums">{careless}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-700">
                <span className="h-2.5 w-2.5 rounded-full bg-miss" /> Knowledge gap
                <span className="font-medium text-ink-900 tabular-nums">{knowledge}</span>
              </span>
            </div>
            <p className="text-micro text-ink-500">
              {data.errors.missedEasy > 0
                ? `${data.errors.missedEasy} easy question${data.errors.missedEasy === 1 ? '' : 's'} missed — the cheapest points to reclaim.`
                : 'No easy questions missed — nice.'}
              {reach > 0 && ` Fixing avoidable misses is worth about +${reach} points.`}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function PacingCard({ data }: { data: Analytics }) {
  const p = data.pacing;
  const slowest = p?.byType[0];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Pacing</CardTitle>
        {p && <span className="text-micro text-ink-400 tabular-nums">budget ~{p.budgetSeconds}s</span>}
      </CardHeader>
      <CardBody className="space-y-4">
        {!p ? (
          <p className="text-small text-ink-400">Answer some questions to see your pace per question.</p>
        ) : (
          <>
            <div className="flex items-end gap-6">
              <div>
                <p className="text-h1 font-semibold text-ink-900 tabular-nums">
                  {p.avgSeconds}<span className="text-h3 text-ink-500">s</span>
                </p>
                <p className="text-micro text-ink-400">avg / question · {p.sampleSize} timed</p>
              </div>
              <p
                className={cn(
                  'mb-1 text-small font-medium',
                  p.avgSeconds <= p.budgetSeconds ? 'text-green' : 'text-amber',
                )}
              >
                {p.avgSeconds <= p.budgetSeconds ? 'within budget' : `${p.avgSeconds - p.budgetSeconds}s over budget`}
              </p>
            </div>

            {/* Accuracy by how long each question took */}
            <div className="space-y-2">
              <p className="text-micro font-medium uppercase tracking-wide text-ink-400">Accuracy by time spent</p>
              {p.buckets.filter((b) => b.total > 0).map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-micro text-ink-500 tabular-nums">{b.label}</span>
                  <ProgressBar value={b.accuracyPercent} tone={accuracyTone(b.accuracyPercent)} className="flex-1" />
                  <span className="w-16 shrink-0 text-right text-micro text-ink-400 tabular-nums">
                    {b.accuracyPercent}% · {b.total}
                  </span>
                </div>
              ))}
            </div>

            {/* Average time by question type — what eats the clock */}
            {p.byType.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-micro font-medium uppercase tracking-wide text-ink-400">
                  Avg time by question type
                </p>
                {p.byType.slice(0, 6).map((t) => (
                  <div key={t.skill} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-small text-ink-700">{t.skill}</span>
                    <span
                      className={cn(
                        'shrink-0 text-small font-medium tabular-nums',
                        t.avgSeconds > p.budgetSeconds ? 'text-amber' : 'text-ink-900',
                      )}
                    >
                      {t.avgSeconds}s
                    </span>
                    <span className="w-8 shrink-0 text-right text-micro text-ink-400 tabular-nums">{t.count}</span>
                  </div>
                ))}
                {slowest && slowest.avgSeconds > p.budgetSeconds && (
                  <p className="pt-1 text-micro text-ink-500">
                    <span className="font-medium text-ink-700">{slowest.skill}</span> eats the most time
                    ({slowest.avgSeconds}s avg) — drill it to speed up.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function DiagnosisCard({ data }: { data: Analytics }) {
  const total = data.diagnosis.reduce((s, d) => s + d.count, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>How you miss</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {total === 0 ? (
          <p className="text-small text-ink-400">
            Tag your misses on the results screen (&ldquo;misread&rdquo;, &ldquo;didn&apos;t know&rdquo;…) to see the pattern here.
          </p>
        ) : (
          data.diagnosis.map((d) => {
            const pct = Math.round((d.count / total) * 100);
            return (
              <div key={d.key} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-small text-ink-700">{diagnosisLabel(d.key) ?? d.key}</span>
                <ProgressBar value={pct} tone="coral" className="flex-1" />
                <span className="w-12 shrink-0 text-right text-small font-medium text-ink-900 tabular-nums">{pct}%</span>
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}

function DomainCard({ data }: { data: Analytics }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Accuracy by domain</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {data.byDomain.length === 0 ? (
          <p className="text-small text-ink-400">No domain data yet.</p>
        ) : (
          data.byDomain.map((s) => (
            <div key={s.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-small text-ink-700">{domainLabel(s.key)}</span>
                <span className="text-small font-medium text-ink-900 tabular-nums">{s.accuracyPercent}%</span>
              </div>
              <ProgressBar value={s.accuracyPercent} tone={accuracyTone(s.accuracyPercent)} />
              <p className="mt-0.5 text-micro text-ink-400 tabular-nums">{s.correct}/{s.total} correct</p>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

function SkillsCard({ data }: { data: Analytics }) {
  const skills = data.weakestSkills.slice(0, 8);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Weakest skills</CardTitle>
        <span className="text-micro text-ink-400">least accurate first</span>
      </CardHeader>
      <CardBody className="divide-y divide-line">
        {skills.length === 0 ? (
          <p className="py-6 text-center text-small text-ink-400">Answer at least 3 in a skill to rank it.</p>
        ) : (
          skills.map((s, i) => (
            <div key={s.key} className="flex items-center gap-4 py-2">
              <div className="w-48 shrink-0">
                <p className={cn('truncate text-body', i === 0 ? 'font-semibold text-ink-900' : 'text-ink-700')}>{s.key}</p>
                <p className="text-micro text-ink-400">{s.total} answered</p>
              </div>
              <ProgressBar value={s.accuracyPercent} tone={accuracyTone(s.accuracyPercent)} className="flex-1" />
              <span className="w-10 shrink-0 text-right text-body font-medium text-ink-900 tabular-nums">{s.accuracyPercent}%</span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

function PracticeMixCard({ data }: { data: Analytics }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Practice mix vs. the real SAT</CardTitle>
        <span className="text-micro text-ink-400">your share vs. official weighting</span>
      </CardHeader>
      <CardBody className="grid gap-4 sm:grid-cols-2">
        {data.practiceMix.map((m) => {
          const under = m.share + 5 < m.targetShare && m.targetShare >= 20;
          return (
            <div key={m.domain}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-small text-ink-700">{domainLabel(m.domain)}</span>
                <span className="text-micro text-ink-400 tabular-nums">
                  you {m.share}% · SAT {m.targetShare}%
                </span>
              </div>
              <div className="relative">
                <ProgressBar value={m.share} tone={under ? 'amber' : 'blue'} />
                {/* target marker */}
                <span
                  className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-700"
                  style={{ left: `${Math.min(100, m.targetShare)}%` }}
                  aria-hidden
                />
              </div>
              {under && <p className="mt-0.5 text-micro text-amber">Under-practiced for how much it counts.</p>}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
