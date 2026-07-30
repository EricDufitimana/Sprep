'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Textarea } from '@/components/ui/input';
import { Reveal } from '@/components/reveal';
import { ScoreLine, ExerciseError } from './exercise-parts';
import { cn } from '@/lib/utils';

interface GradeResult {
  graded: boolean;
  score: number | null;
  verdict: string | null;
  feedback: string | null;
  correctDefinition: string;
  charge: 'positive' | 'negative' | 'neutral' | null;
}

const VERDICT_TONE: Record<string, BadgeTone> = { close: 'green', partial: 'amber', off: 'miss' };
const CHARGE_TONE: Record<string, BadgeTone> = { positive: 'green', negative: 'miss', neutral: 'blue' };

/** (c) Free-response definition — AI-graded. The key feature. */
export function FreeResponseExercise() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const word = useQuery(trpc.vocabulary.freeResponseWord.queryOptions());
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const grade = useMutation(
    trpc.vocabulary.gradeAnswer.mutationOptions({
      onSuccess: (res) => {
        setResult(res);
        if (res.score !== null) {
          setScore((s) => ({ correct: s.correct + (res.score! >= 70 ? 1 : 0), total: s.total + 1 }));
        }
        void queryClient.invalidateQueries(trpc.vocabulary.progress.queryFilter());
      },
    }),
  );

  const next = () => {
    setAnswer('');
    setResult(null);
    grade.reset();
    void word.refetch();
  };

  if (word.isLoading) {
    return <div className="h-72 animate-pulse rounded-card border border-line bg-sunken/50" />;
  }
  if (word.isError || !word.data) {
    return <ExerciseError message={word.error?.message ?? 'Could not load a word.'} onRetry={() => word.refetch()} />;
  }

  const w = word.data;
  // Grading fires only on this explicit submit — never on keystrokes.
  const submit = () => grade.mutate({ wordId: w.wordId, userAnswer: answer.trim() });

  return (
    <Reveal key={w.wordId}>
      <Card>
        <CardBody className="space-y-5">
          <ScoreLine label="Define it yourself" score={score} />

          <div>
            <span className="accent-serif text-h1 text-ink-900">{w.word}</span>
            {w.partOfSpeech && <span className="ml-2 text-body italic text-ink-400">{w.partOfSpeech}</span>}
          </div>

          <Textarea
            label="Define it in your own words"
            placeholder="Wording doesn't matter — capture the meaning and the tone."
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={result !== null || grade.isPending}
          />

          {grade.isError && !result && (
            <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
              {grade.error.message}
            </p>
          )}

          {result ? (
            <div className="space-y-4">
              {result.graded ? (
                <div className="space-y-3 rounded-card border border-line bg-sunken/40 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-h2 font-semibold tabular-nums text-ink-900">{result.score}</span>
                    <span className="text-small text-ink-400">/ 100</span>
                    {result.verdict && (
                      <Badge tone={VERDICT_TONE[result.verdict] ?? 'neutral'}>{result.verdict}</Badge>
                    )}
                    {result.charge && (
                      <Badge tone={CHARGE_TONE[result.charge]}>{result.charge}</Badge>
                    )}
                  </div>
                  {result.feedback && <p className="text-body text-ink-700">{result.feedback}</p>}
                </div>
              ) : (
                <p className="rounded-control bg-amber-tint px-3 py-2 text-small text-amber">
                  Couldn&apos;t score that one right now — here&apos;s the definition so you can check yourself.
                </p>
              )}

              <div>
                <p className="text-small font-medium text-ink-500">Correct definition</p>
                <p className="mt-0.5 text-body text-ink-900">{result.correctDefinition}</p>
              </div>

              <div className="flex justify-end">
                <Button onClick={next}>
                  Next word
                  <Icon name="arrow-right" className="text-small" />
                </Button>
              </div>
            </div>
          ) : (
            <Button disabled={answer.trim().length === 0 || grade.isPending} onClick={submit}>
              {grade.isPending ? (
                <>
                  <Icon name="spinner-solid" className={cn('text-small', 'animate-spin')} />
                  Grading…
                </>
              ) : (
                'Submit for grading'
              )}
            </Button>
          )}
        </CardBody>
      </Card>
    </Reveal>
  );
}
