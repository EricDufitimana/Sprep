'use client';

import { useState } from 'react';
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
import { Tabs } from '@/components/ui/tabs';
import { color } from '@/lib/tokens';
import { accuracyTone, domainLabel, formatDate } from '@/lib/labels';

export default function ProgressPage() {
  const router = useRouter();
  const trpc = useTRPC();

  const trend = useQuery(trpc.progress.scoreTrend.queryOptions({ limit: 20 }));
  const sections = useQuery(trpc.progress.sectionAverages.queryOptions());
  const weakest = useQuery(trpc.progress.weakestSkills.queryOptions({ limit: 20, minAnswered: 1 }));

  const [track, setTrack] = useState<string>('overall');

  const isLoading = trend.isLoading || sections.isLoading || weakest.isLoading;
  const points = trend.data ?? [];

  if (isLoading) {
    return (
      <>
        <PageHeader title="Progress" description="Your sittings over time, cut by domain." />
        <div className="h-64 animate-pulse rounded-card border border-line bg-sunken/50" />
      </>
    );
  }

  if (points.length === 0) {
    return (
      <>
        <PageHeader title="Progress" description="Your sittings over time, cut by domain." />
        <EmptyState
          icon="bar-chart"
          title="Nothing to chart yet"
          description="Submit a test and your accuracy over time — plus the skills costing you the most — will appear here."
          action={
            <Button onClick={() => router.push('/dashboard/practice')}>
              Sit a test
              <Icon name="arrow-right" className="text-small" />
            </Button>
          }
        />
      </>
    );
  }

  const worst = weakest.data?.[0];
  const tabItems = [
    { value: 'overall', label: 'Overall' },
    ...(sections.data ?? []).map((s) => ({
      value: s.domain,
      label: domainLabel(s.domain).split(' ')[0],
    })),
  ];

  return (
    <>
      <PageHeader title="Progress" description="Your sittings over time, cut by domain." />

      {worst && (
        <Reveal>
          <Card className="border-blue/30 bg-blue-wash">
            <CardBody>
              <p className="text-body text-ink-700">
                Your weakest area is{' '}
                <span className="accent-serif text-h3 text-blue">
                  {worst.skill ?? domainLabel(worst.domain)}
                </span>{' '}
                — {worst.accuracyPercent}% over {worst.totalAnswered} answered questions.
              </p>
            </CardBody>
          </Card>
        </Reveal>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Reveal delay={0.08} className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Score over time</CardTitle>
              {tabItems.length > 1 && <Tabs items={tabItems} value={track} onChange={setTrack} />}
            </CardHeader>
            <CardBody>
              {track === 'overall' ? (
                <TrendChart points={points} />
              ) : (
                <DomainReadout domain={track} sections={sections.data ?? []} />
              )}
              {track === 'overall' && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-400">
                  {points.map((p) => (
                    <span key={p.attemptId} className="tabular-nums">
                      {formatDate(p.submittedAt)} · {Math.round(p.scorePercent)}%
                    </span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </Reveal>

        <Reveal delay={0.14}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Accuracy by domain</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {(sections.data ?? []).length === 0 ? (
                <p className="text-small text-ink-400">No domain data yet.</p>
              ) : (
                sections.data!.map((s) => (
                  <div key={s.domain}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="text-small text-ink-700">{domainLabel(s.domain)}</span>
                      <span className="text-small font-medium text-ink-900 tabular-nums">
                        {s.accuracyPercent}%
                      </span>
                    </div>
                    <ProgressBar value={s.accuracyPercent} tone={accuracyTone(s.accuracyPercent)} />
                    <p className="mt-0.5 text-micro text-ink-400 tabular-nums">
                      {s.totalCorrect}/{s.totalAnswered} correct
                    </p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.2} className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Accuracy by skill</CardTitle>
          </CardHeader>
          <CardBody className="divide-y divide-line">
            {(weakest.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-small text-ink-400">No skill data yet.</p>
            ) : (
              weakest.data!.map((s, i) => (
                <div key={`${s.domain}-${s.skill}`} className="flex items-center gap-4 py-2">
                  <div className="w-56 shrink-0">
                    <p
                      className={
                        i === 0
                          ? 'truncate text-body font-semibold text-ink-900'
                          : 'truncate text-body text-ink-700'
                      }
                    >
                      {s.skill ?? domainLabel(s.domain)}
                    </p>
                    <p className="text-micro text-ink-400">{s.totalAnswered} answered</p>
                  </div>
                  <ProgressBar
                    value={s.accuracyPercent}
                    tone={accuracyTone(s.accuracyPercent)}
                    className="flex-1"
                  />
                  <span className="w-10 shrink-0 text-right text-body font-medium text-ink-900 tabular-nums">
                    {s.accuracyPercent}%
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </Reveal>
    </>
  );
}

/** Minimal SVG line chart over submitted attempts. No chart junk. */
function TrendChart({ points }: { points: { attemptId: string; scorePercent: number }[] }) {
  const width = 640;
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 12, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const x = (i: number) =>
    pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.scorePercent).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Score over time: ${points.map((p) => Math.round(p.scorePercent)).join(', ')} percent`}
      className="w-full"
    >
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad.left} x2={width - pad.right} y1={y(g)} y2={y(g)} stroke={color.line} strokeWidth={1} />
          <text x={pad.left - 8} y={y(g) + 3} textAnchor="end" fontSize={10} fill={color.ink[400]}>
            {g}
          </text>
        </g>
      ))}
      {points.length > 1 && (
        <path
          d={path}
          fill="none"
          stroke={color.blue.DEFAULT}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {points.map((p, i) => (
        <circle
          key={p.attemptId}
          cx={x(i)}
          cy={y(p.scorePercent)}
          r={3.5}
          fill={color.surface}
          stroke={color.blue.DEFAULT}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

function DomainReadout({
  domain,
  sections,
}: {
  domain: string;
  sections: {
    domain: string;
    accuracyPercent: number;
    totalCorrect: number;
    totalAnswered: number;
  }[];
}) {
  const s = sections.find((x) => x.domain === domain);
  if (!s) return <p className="py-8 text-center text-small text-ink-400">No data for this domain.</p>;
  return (
    <div className="py-6">
      <p className="text-score font-semibold text-ink-900 tabular-nums">{s.accuracyPercent}%</p>
      <p className="mt-1 text-body text-ink-500">
        {domainLabel(s.domain)} — {s.totalCorrect} of {s.totalAnswered} correct
      </p>
      <ProgressBar value={s.accuracyPercent} tone={accuracyTone(s.accuracyPercent)} className="mt-4" />
    </div>
  );
}
