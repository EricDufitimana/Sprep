'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { QuestionFigure } from '@/components/question-figure';

export interface ReviewQuestion {
  questionText: string;
  passage?: string | null;
  options: unknown;
  correctAnswer: string | null;
  explanation?: string | null;
  yourAnswer: string | null;
  visualUrl?: string | null;
  visualData?: string | null;
  skill?: string | null;
  difficulty?: string | null;
  externalId?: string | null;
}

type Opt = { letter: string; text: string };

/**
 * A question with its choices, and the answer behind a single button.
 *
 * The reveal is one click — no note to write first. Hiding it by default still
 * gives you the beat to re-attempt the question in your head, which is where
 * the learning is, but nothing blocks you from just looking.
 */
export function QuestionReview({
  question,
  className,
}: {
  question: ReviewQuestion;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const options = (question.options as Opt[]) ?? [];

  return (
    <div className={className}>
      <QuestionFigure url={question.visualUrl} description={question.visualData} className="my-3" />

      {question.passage && (
        <p className="mb-3 whitespace-pre-line text-small leading-6 text-ink-500">
          {question.passage}
        </p>
      )}

      <p className="mb-3 text-body font-medium text-ink-900">{question.questionText}</p>

      <div className="space-y-1.5">
        {options.map((opt) => {
          const isPick = question.yourAnswer === opt.letter;
          const isAnswer = question.correctAnswer === opt.letter;

          // Before the reveal, only the user's own pick is marked — showing the
          // correct one would defeat the point of the button.
          const tone = !revealed
            ? isPick
              ? 'border-blue bg-blue-tint text-ink-900'
              : 'border-line text-ink-700'
            : isAnswer
              ? 'border-green/50 bg-green-tint text-ink-900'
              : isPick
                ? 'border-miss/50 bg-miss-tint text-ink-900'
                : 'border-line text-ink-500';

          return (
            <div
              key={opt.letter}
              className={cn('flex items-baseline gap-2.5 rounded-control border px-3 py-2 text-small', tone)}
            >
              <span className="font-semibold">{opt.letter}</span>
              <span className="flex-1">{opt.text}</span>
              {isPick && (
                <span className="shrink-0 text-micro font-medium text-ink-500">your answer</span>
              )}
              {revealed && isAnswer && (
                <Icon name="checkmark-circle" className="translate-y-0.5 text-green" label="Correct answer" />
              )}
              {revealed && isPick && !isAnswer && (
                <Icon name="cross-circle" className="translate-y-0.5 text-miss" label="Your pick" />
              )}
            </div>
          );
        })}
      </div>

      {!revealed ? (
        <Button size="sm" className="mt-3" onClick={() => setRevealed(true)}>
          Reveal answer
          <Icon name="chevron-down" className="text-small" />
        </Button>
      ) : (
        question.explanation && (
          <div className="mt-3 rounded-control bg-paper px-3 py-2.5">
            <p className="mb-1 text-micro font-medium uppercase tracking-wide text-ink-400">
              Why
            </p>
            <p className="whitespace-pre-line text-small leading-6 text-ink-700">
              {question.explanation}
            </p>
          </div>
        )
      )}
    </div>
  );
}

/** Metadata row shared by the review surfaces. */
export function QuestionMeta({
  correct,
  unanswered,
  skill,
  difficulty,
  externalId,
  flagged,
  label,
}: {
  correct?: boolean;
  unanswered?: boolean;
  skill?: string | null;
  difficulty?: string | null;
  externalId?: string | null;
  flagged?: boolean;
  label?: string;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {label && <span className="text-small font-semibold text-ink-900 tabular-nums">{label}</span>}
      {correct !== undefined && (
        <Badge tone={correct ? 'green' : unanswered ? 'neutral' : 'miss'}>
          {correct ? 'Correct' : unanswered ? 'Unanswered' : 'Missed'}
        </Badge>
      )}
      {skill && <Badge tone="neutral">{skill}</Badge>}
      {difficulty && <Badge tone="neutral">{difficulty}</Badge>}
      {flagged && <Badge tone="amber">Flagged</Badge>}
      {externalId && (
        <span className="ml-auto font-mono text-micro text-ink-400">ID {externalId}</span>
      )}
    </div>
  );
}
