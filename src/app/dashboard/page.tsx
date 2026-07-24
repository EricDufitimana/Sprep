'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Stat } from '@/components/ui/stat';
import { accuracyTone, domainLabel, domainShort, formatDate } from '@/lib/labels';

export default function DashboardPage() {
  const router = useRouter();
  const trpc = useTRPC();

  const overview = useQuery(trpc.progress.overview.queryOptions());
  const weakest = useQuery(trpc.progress.weakestSkills.queryOptions({ limit: 6 }));
  const attempts = useQuery(trpc.tests.listAttempts.queryOptions({ limit: 5 }));

  const isLoading = overview.isLoading || weakest.isLoading || attempts.isLoading;
  const o = overview.data;
  const hasSittings = (o?.testsTaken ?? 0) > 0;

  if (isLoading) {
    return (
      <>
        <PageHeader title="Dashboard" description="Where you stand, and where to push next." />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-card border border-line bg-sunken/50" />
          ))}
        </div>
      </>
    );
  }

  const delta =
    o?.latestScorePercent != null && o?.previousScorePercent != null
      ? Math.round((o.latestScorePercent - o.previousScorePercent) * 10) / 10
      : null;

  return (
    <>
      <PageHeader title="Dashboard" description="Where you stand, and where to push next.">
        <Button onClick={() => router.push('/dashboard/practice')}>
          <Icon name="pencil" className="text-small" />
          Start a test
        </Button>
      </PageHeader>

      {/* Stats always render — zeros are a real reading of "nothing sat yet",
          and the layout stays put once data arrives. */}
      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Latest score"
          value={Math.round(o?.latestScorePercent ?? 0)}
          suffix="%"
          hint={
            !hasSittings
              ? 'no sittings yet'
              : delta === null
                ? 'first sitting'
                : `${delta >= 0 ? '+' : ''}${delta} pts vs previous`
          }
          hintTone={!hasSittings || delta === null ? 'neutral' : delta >= 0 ? 'up' : 'down'}
          tone="amber"
        />
        <Stat
          label="Tests taken"
          value={o?.testsTaken ?? 0}
          hint={hasSittings ? 'submitted' : 'nothing submitted'}
          tone="violet"
        />
        <Stat
          label="Average score"
          value={Math.round(o?.averageScorePercent ?? 0)}
          suffix="%"
          hint={hasSittings ? 'all sittings' : 'no sittings yet'}
          tone="green"
        />
        {o?.weakestSkill ? (
          <Card className="border-miss/30 bg-miss-tint/50 px-5 py-4">
            <p className="text-small text-ink-700">Weakest skill</p>
            <p className="accent-serif mt-1 text-h2 text-miss">{o.weakestSkill.skill ?? '—'}</p>
            <p className="mt-1 text-micro text-ink-500 tabular-nums">
              {o.weakestSkill.accuracyPercent}% across {o.weakestSkill.totalAnswered} questions
            </p>
          </Card>
        ) : (
          <Card className="px-5 py-4">
            <p className="text-small text-ink-500">Weakest skill</p>
            <p className="accent-serif mt-1 text-h2 text-ink-400">Not enough data</p>
            <p className="mt-1 text-micro text-ink-400">Sit a test to find it.</p>
          </Card>
        )}
      </Reveal>

      {!hasSittings && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-blue/25 bg-blue-wash px-5 py-4">
          <p className="text-body text-ink-700">
            Nothing measured yet — upload a paper and sit your first test.
          </p>
          <Button size="sm" onClick={() => router.push('/dashboard/practice')}>
            Go to practice
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <Reveal delay={0.08} className="lg:col-span-3">
              <Card>
                <CardHeader>
                  <CardTitle>Where you struggle most</CardTitle>
                  <Link
                    href="/dashboard/progress"
                    className="rounded-sm text-small text-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                  >
                    See patterns
                  </Link>
                </CardHeader>
                <CardBody className="divide-y divide-line">
                  {(weakest.data?.length ?? 0) === 0 ? (
                    <p className="py-6 text-center text-small text-ink-400">
                      Answer a few more questions and your weak spots will surface here.
                    </p>
                  ) : (
                    weakest.data!.map((s, i) => (
                      <div
                        key={`${s.domain}-${s.skill}`}
                        className={i === 0 ? '-mx-3 rounded-control bg-miss-tint/60 px-3 py-2' : 'py-2'}
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-4">
                          <div className="min-w-0">
                            <p className={i === 0 ? 'truncate text-body font-semibold text-ink-900' : 'truncate text-body text-ink-700'}>
                              {s.skill ?? domainLabel(s.domain)}
                            </p>
                            <p className="text-micro text-ink-400">
                              {domainLabel(s.domain)} · {s.totalAnswered} answered
                            </p>
                          </div>
                          <span className="shrink-0 text-body font-medium text-ink-900 tabular-nums">
                            {s.accuracyPercent}%
                          </span>
                        </div>
                        <ProgressBar
                          value={s.accuracyPercent}
                          tone={accuracyTone(s.accuracyPercent)}
                          label={`${s.skill ?? ''} accuracy`}
                        />
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            </Reveal>

            <Reveal delay={0.14} className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Recent tests</CardTitle>
                </CardHeader>
                <CardBody className="space-y-3">
                  {(attempts.data?.length ?? 0) === 0 ? (
                    <p className="py-6 text-center text-small text-ink-400">No sittings yet.</p>
                  ) : (
                    attempts.data!.map((a) => (
                      <Link
                        key={a.id}
                        href={`/test/${a.bankId}/results?attempt=${a.id}`}
                        className="block rounded-control p-2 transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-body font-medium text-ink-900">{a.bankName}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-micro text-ink-400">
                                {formatDate(a.submittedAt ?? a.startedAt)}
                              </span>
                              <Badge tone={a.timed ? 'blue' : 'neutral'}>
                                {a.timed ? 'Timed' : 'Untimed'}
                              </Badge>
                              {a.sections.map((s) => (
                                <Badge key={s.domain} tone="neutral">
                                  {domainShort(s.domain)} {s.correct}/{s.total}
                                </Badge>
                              ))}
                            </p>
                          </div>
                          <span className="shrink-0 text-lead font-semibold text-ink-900 tabular-nums">
                            {a.status === 'submitted' ? `${Math.round(a.scorePercent ?? 0)}%` : '—'}
                          </span>
                        </div>
                      </Link>
                    ))
                  )}
                </CardBody>
              </Card>
            </Reveal>
      </div>
    </>
  );
}
