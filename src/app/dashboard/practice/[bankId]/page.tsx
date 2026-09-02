'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Modal } from '@/components/ui/modal';
import { Stat } from '@/components/ui/stat';
import { QuestionMeta, QuestionReview } from '@/components/question-review';
import { RichText } from '@/components/rich-text';
import { accuracyTone, domainLabel, formatDuration, formatRelative } from '@/lib/labels';
import { mathPreview } from '@/lib/math-preview';
import { cn } from '@/lib/utils';

/** One-line preview text: readable math for math questions, rich text otherwise. */
function QPreview({ text, section }: { text: string; section?: string | null }) {
  if (section === 'math') return <>{mathPreview(text)}</>;
  return <RichText>{text}</RichText>;
}

/** A question bank's record: how it's gone, and what keeps going wrong. */
export default function BankDetailPage() {
  const { bankId } = useParams<{ bankId: string }>();
  const router = useRouter();
  const trpc = useTRPC();

  const stats = useQuery(trpc.questionBanksManagement.stats.queryOptions({ bankId }));
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);

  if (stats.isLoading) {
    return (
      <>
        <PageHeader title="Bank" description="Loading…" />
        <div className="h-48 animate-pulse rounded-card border border-line bg-sunken/50" />
      </>
    );
  }

  if (stats.isError || !stats.data) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-body text-ink-700">{stats.error?.message ?? 'Bank not found.'}</p>
        <Button onClick={() => router.push('/dashboard/practice')}>Back to practice</Button>
      </div>
    );
  }

  const { bank, summary, attempts, questions, missed } = stats.data;
  const active = questions.find((q) => q.id === openQuestionId) ?? null;
  const coverage = bank.verifiedCount > 0 ? (bank.attemptedCount / bank.verifiedCount) * 100 : 0;

  return (
    <>
      <PageHeader title={bank.name} description={bank.description ?? undefined}>
        <Button variant="ghost" onClick={() => router.push('/dashboard/practice')}>
          <Icon name="arrow-left" className="text-small" />
          All banks
        </Button>
      </PageHeader>

      {/* Coverage — the same figure the card's progress bar shows */}
      <Reveal>
        <Card className="border-blue/25 bg-blue-wash">
          <CardBody>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-body text-ink-700">
                You’ve worked{' '}
                <strong className="font-semibold text-ink-900">
                  {bank.attemptedCount} of {bank.verifiedCount}
                </strong>{' '}
                questions in this bank.
              </p>
              <span className="text-small text-ink-500 tabular-nums">
                {Math.round(coverage)}% covered
              </span>
            </div>
            <ProgressBar value={coverage} tone="blue" label="Bank coverage" />
            {bank.remainingCount > 0 && (
              <p className="mt-2 text-small text-ink-500">
                {bank.remainingCount} question{bank.remainingCount === 1 ? '' : 's'} still untouched
                — start a sitting with “skip questions I’ve done” to go straight at them.
              </p>
            )}
          </CardBody>
        </Card>
      </Reveal>

      <Reveal stagger className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sittings" value={summary.sittings} hint="submitted" tone="violet" />
        <Stat
          label="Best score"
          value={Math.round(summary.bestScorePercent ?? 0)}
          suffix="%"
          hint={summary.bestScorePercent === null ? 'no sittings yet' : 'personal best'}
          tone="green"
        />
        <Stat
          label="Latest score"
          value={Math.round(summary.latestScorePercent ?? 0)}
          suffix="%"
          hint={summary.latestScorePercent === null ? 'no sittings yet' : 'most recent'}
          tone="amber"
        />
        <Stat
          label="Average"
          value={Math.round(summary.averageScorePercent ?? 0)}
          suffix="%"
          hint="all sittings"
        />
      </Reveal>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Sitting log */}
        <Reveal delay={0.08}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Sitting log</CardTitle>
              <Badge tone="neutral">{attempts.length}</Badge>
            </CardHeader>
            <CardBody className="space-y-2">
              {attempts.length === 0 ? (
                <p className="py-6 text-center text-small text-ink-400">
                  No sittings yet.
                </p>
              ) : (
                attempts.map((a) => (
                  <Link
                    key={a.id}
                    href={a.status === 'submitted' ? `/test/${a.id}/results` : `/test/${a.id}`}
                    className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2 transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink-900">
                        {a.status === 'submitted'
                          ? `${Math.round(a.scorePercent ?? 0)}%`
                          : 'In progress'}
                        {a.status === 'submitted' && (
                          <span className="ml-2 text-small font-normal text-ink-500 tabular-nums">
                            {a.correctCount}/{a.totalQuestions}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro text-ink-400">
                        {formatRelative(a.submittedAt ?? a.startedAt)}
                        <Badge tone={a.timed ? 'blue' : 'neutral'}>
                          {a.timed ? 'Timed' : 'Untimed'}
                        </Badge>
                        {a.timeUsedSeconds !== null && (
                          <span className="tabular-nums">{formatDuration(a.timeUsedSeconds)}</span>
                        )}
                      </p>
                    </div>
                    <Icon name="chevron-right" className="shrink-0 text-small text-ink-400" />
                  </Link>
                ))
              )}
            </CardBody>
          </Card>
        </Reveal>

        {/* What keeps going wrong */}
        <Reveal delay={0.14}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Questions you’ve missed</CardTitle>
              {missed.length > 0 && <Badge tone="miss">{missed.length}</Badge>}
            </CardHeader>
            <CardBody className="space-y-2">
              {missed.length === 0 ? (
                <p className="py-6 text-center text-small text-ink-400">
                  {bank.attemptedCount === 0
                    ? 'Sit the bank and your misses will collect here.'
                    : 'Nothing missed yet — clean sheet.'}
                </p>
              ) : (
                missed.slice(0, 12).map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setOpenQuestionId(q.id)}
                    className="w-full rounded-control border border-line px-3 py-2 text-left transition-colors hover:border-ink-400/50 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-small text-ink-700">
                        <QPreview text={q.questionText} section={q.section} />
                      </p>
                      <span className="shrink-0 text-small font-medium text-miss tabular-nums">
                        {q.missed}× wrong
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      {q.skill && <Badge tone="neutral">{q.skill}</Badge>}
                      {q.difficulty && <Badge tone="neutral">{q.difficulty}</Badge>}
                      {q.externalId && (
                        <span className="font-mono text-micro text-ink-400">ID {q.externalId}</span>
                      )}
                      <span className="ml-auto text-micro text-blue">Review →</span>
                    </p>
                  </button>
                ))
              )}
            </CardBody>
          </Card>
        </Reveal>
      </div>

      {/* Per-question coverage */}
      <Reveal delay={0.2} className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Every question</CardTitle>
            <span className="text-small text-ink-400 tabular-nums">
              {bank.attemptedCount}/{bank.verifiedCount} attempted
            </span>
          </CardHeader>
          <CardBody className="divide-y divide-line">
            {questions.map((q, i) => (
              <div
                key={q.id}
                role={q.detail ? 'button' : undefined}
                tabIndex={q.detail ? 0 : undefined}
                onClick={() => q.detail && setOpenQuestionId(q.id)}
                onKeyDown={(e) => {
                  if (q.detail && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setOpenQuestionId(q.id);
                  }
                }}
                className={cn(
                  'flex items-center gap-4 py-2',
                  q.detail &&
                    'cursor-pointer rounded-control px-2 -mx-2 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                )}
              >
                <span className="w-7 shrink-0 text-small text-ink-400 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small text-ink-700">
                    <QPreview text={q.questionText} section={q.section} />
                  </p>
                  <p className="text-micro text-ink-400">
                    {q.skill ?? domainLabel(q.domain)}
                    {q.seen > 0 && ` · seen ${q.seen}×`}
                  </p>
                </div>
                {q.seen === 0 ? (
                  <Badge tone="neutral">Not attempted</Badge>
                ) : (
                  <>
                    <div className="hidden w-28 sm:block">
                      <ProgressBar
                        value={q.accuracyPercent ?? 0}
                        tone={accuracyTone(q.accuracyPercent ?? 0)}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-small font-medium text-ink-900 tabular-nums">
                      {q.accuracyPercent}%
                    </span>
                  </>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      </Reveal>

      {/* Full question review. Only ever opened for questions already
          attempted — `detail` is null otherwise, so nothing is spoiled. */}
      <Modal
        open={active !== null}
        onClose={() => setOpenQuestionId(null)}
        title={active ? `Question ${active.position ?? ''}`.trim() : 'Question'}
        className="max-w-2xl"
      >
        {active?.detail && (
          <>
            <QuestionMeta
              correct={active.missed === 0}
              skill={active.skill}
              difficulty={active.difficulty}
              externalId={active.externalId}
              questionId={active.id}
            />
            <p className="mb-3 text-small text-ink-500 tabular-nums">
              Seen {active.seen}× · {active.correct} correct · {active.missed} missed
            </p>
            <QuestionReview
              question={{
                questionText: active.questionText,
                passage: active.detail.passage,
                options: active.detail.options,
                correctAnswer: active.detail.correctAnswer,
                explanation: active.detail.explanation,
                yourAnswer: active.detail.yourAnswer,
                visualUrl: active.detail.visualUrl,
                visualData: active.detail.visualData,
                section: active.section,
                answerFormat: active.answerFormat,
              }}
            />
          </>
        )}
      </Modal>
    </>
  );
}
