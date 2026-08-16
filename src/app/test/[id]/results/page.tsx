'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { QuestionMeta, QuestionReview } from '@/components/question-review';
import { UntimedTaker, type BuiltQuestion } from '@/components/untimed-taker';
import { accuracyTone, domainLabel, formatDuration } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { DIAGNOSIS_REASONS, type DiagnosisKey } from '@/lib/diagnosis';

export default function ResultsPage() {
  const { id: attemptId } = useParams<{ id: string }>();
  const router = useRouter();
  const trpc = useTRPC();

  const results = useQuery(trpc.tests.getResults.queryOptions({ attemptId }));

  // "Redo your misses" — an untimed second pass over just the wrong ones.
  const [redoing, setRedoing] = useState(false);
  const failed = useQuery({
    ...trpc.tests.failedQuestions.queryOptions({ attemptId }),
    enabled: redoing,
  });

  if (redoing) {
    const qs = failed.data?.questions ?? [];
    if (failed.isLoading) {
      return <p className="py-12 text-center text-body text-ink-500">Gathering the ones you missed…</p>;
    }
    if (qs.length > 0) {
      return (
        <UntimedTaker
          questions={qs as unknown as BuiltQuestion[]}
          scopeLabel="Redo — questions you missed"
          onExit={() => setRedoing(false)}
        />
      );
    }
    // Nothing to redo (or the load failed) — fall through to the results below.
  }

  if (results.isLoading) {
    return <p className="py-12 text-center text-body text-ink-500">Loading your results…</p>;
  }

  if (results.isError || !results.data) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-body text-ink-700">{results.error?.message ?? 'Results unavailable.'}</p>
        <Button onClick={() => router.push('/dashboard/practice')}>Back to practice</Button>
      </div>
    );
  }

  const r = results.data;
  const missed = r.totalQuestions - r.correctCount;

  return (
    <>
      <PageHeader
        title="Results"
        description={`${r.totalQuestions} questions · ${formatDuration(r.timeUsedSeconds)}`}
      >
        <Button variant="ghost" onClick={() => router.push('/dashboard/practice')}>
          <Icon name="arrow-left" className="text-small" />
          Back to practice
        </Button>
      </PageHeader>

      <Reveal>
        <Card>
          <CardBody className="flex flex-wrap items-center gap-8">
            <div>
              <p className="text-score font-semibold text-ink-900 tabular-nums">
                {Math.round(r.scorePercent)}%
              </p>
              <p className="accent-serif mt-1 text-lead text-ink-500">
                {r.scorePercent >= 80
                  ? 'strong sitting'
                  : r.scorePercent >= 65
                    ? 'solid — review the misses'
                    : 'rough one — the review below is the work'}
              </p>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Badge tone="blue">{r.correctCount}/{r.totalQuestions} correct</Badge>
              <Badge tone="neutral">{r.unansweredCount} blank</Badge>
              <Badge tone="amber">{r.flaggedCount} flagged</Badge>
              <Badge tone="miss">{missed} missed</Badge>
            </div>
          </CardBody>
        </Card>
      </Reveal>

      {/* Analysis — accuracy split by domain and by skill, side by side. */}
      {(r.byDomain.length > 0 || r.bySkill.length > 0) && (
        <Reveal className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <CardBody>
              <Breakdown title="By domain" rows={r.byDomain} label={(k) => domainLabel(k)} />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <Breakdown title="By skill" rows={r.bySkill} label={(k) => k} />
            </CardBody>
          </Card>
        </Reveal>
      )}

      {/* Redo the misses, untimed — a second attempt to see if it sticks. */}
      {missed > 0 && (
        <Reveal>
          <Card className="mt-4 border-blue/20 bg-blue-wash">
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-h3 font-semibold text-ink-900">Redo your misses</h3>
                <p className="mt-0.5 max-w-xl text-small text-ink-500">
                  Work the {missed} question{missed === 1 ? '' : 's'} you got wrong again — untimed,
                  with the answer and explanation after each. See if it sticks the second time.
                </p>
              </div>
              <Button onClick={() => setRedoing(true)} disabled={failed.isFetching}>
                <Icon name="reload" className="text-small" />
                {failed.isFetching ? 'Loading…' : `Redo ${missed} untimed`}
              </Button>
            </CardBody>
          </Card>
        </Reveal>
      )}

      <h2 className="mb-3 mt-8 text-h2 font-semibold text-ink-900">Question review</h2>

      <Reveal stagger className="space-y-4">
        {r.questions.map((q, i) => (
          <Card key={q.questionId}>
            <CardBody>
              <QuestionMeta
                label={`Q${i + 1}`}
                correct={q.isCorrect}
                unanswered={q.selectedAnswer === null}
                skill={q.skill}
                flagged={q.flagged}
                externalId={q.externalId}
              />
              <QuestionReview
                question={{
                  questionText: q.questionText,
                  passage: q.passage,
                  options: q.options,
                  correctAnswer: q.correctAnswer,
                  explanation: q.explanation,
                  yourAnswer: q.selectedAnswer,
                  visualUrl: q.visualUrl,
                  visualData: q.visualData,
                  section: q.section,
                  answerFormat: q.answerFormat,
                }}
                // Questions they got right have nothing to reveal — show them
                // already confirmed, no button. Missed/blank keep the reveal.
                showReveal={!q.isCorrect}
                defaultRevealed={q.isCorrect}
              />
              {!q.isCorrect && (
                <DiagnosisPicker
                  attemptId={attemptId}
                  questionId={q.questionId}
                  initial={(q.selfDiagnosis as DiagnosisKey | null) ?? null}
                />
              )}
            </CardBody>
          </Card>
        ))}
      </Reveal>
    </>
  );
}

/**
 * Accuracy split for one facet (domain or skill) as labelled progress bars,
 * hardest-first so the weakest areas sit at the top where they're seen.
 */
function Breakdown({
  title,
  rows,
  label,
}: {
  title: string;
  rows: { key: string; correct: number; total: number; accuracyPercent: number }[];
  label: (key: string) => string;
}) {
  const sorted = [...rows].sort((a, b) => a.accuracyPercent - b.accuracyPercent);
  return (
    <div>
      <p className="mb-3 text-micro font-medium uppercase tracking-wide text-ink-400">{title}</p>
      {sorted.length === 0 ? (
        <p className="text-small text-ink-400">No breakdown for this sitting.</p>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((s) => (
            <div key={s.key}>
              <div className="mb-1 flex items-baseline justify-between gap-4">
                <span className="truncate text-small text-ink-700">{label(s.key)}</span>
                <span className="shrink-0 text-small font-medium text-ink-900 tabular-nums">
                  {s.correct}/{s.total}
                </span>
              </div>
              <ProgressBar
                value={s.accuracyPercent}
                tone={accuracyTone(s.accuracyPercent)}
                label={`${label(s.key)} score`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Why did you miss this?" — pick one reason (or none). Selectable rather than
 * free text so the choices roll up on the Progress page ("How you miss").
 */
function DiagnosisPicker({
  attemptId,
  questionId,
  initial,
}: {
  attemptId: string;
  questionId: string;
  initial: DiagnosisKey | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<DiagnosisKey | null>(initial);

  const save = useMutation(
    trpc.answers.saveDiagnosis.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.progress.analytics.queryFilter());
      },
    }),
  );

  const pick = (key: DiagnosisKey) => {
    const next = selected === key ? null : key;
    setSelected(next);
    save.mutate({ attemptId, questionId, reason: next });
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-micro font-medium uppercase tracking-wide text-ink-400">Why did you miss this?</p>
      <div className="flex flex-wrap gap-1.5">
        {DIAGNOSIS_REASONS.map((r) => {
          const on = selected === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => pick(r.key)}
              title={r.hint}
              aria-pressed={on}
              className={cn(
                'rounded-pill border px-3 py-1 text-small transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                on
                  ? 'border-blue bg-blue-tint font-medium text-blue'
                  : 'border-line text-ink-700 hover:border-ink-400/50 hover:text-ink-900',
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
