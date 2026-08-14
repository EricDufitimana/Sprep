'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { QuestionFigure } from '@/components/question-figure';
import { RichText } from '@/components/rich-text';
import { MathHtml } from '@/components/math-html';

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
  /** 'reading_writing' | 'math'. Math renders rich HTML/MathML. */
  section?: string | null;
  /** 'mcq' | 'spr'. SPR shows a typed answer instead of choices. */
  answerFormat?: string | null;
}

type Opt = { letter: string; text: string };

/** Stem/choice/explanation text: rich HTML for math, whitelisted text for R&W. */
function QText({ children, isMath, block = true }: { children: string | null | undefined; isMath: boolean; block?: boolean }) {
  if (isMath) return <MathHtml html={children} block={block} />;
  return <RichText>{children}</RichText>;
}

/**
 * A question with its choices, and the answer behind a single button.
 *
 * The reveal is one click — no note to write first. Hiding it by default still
 * gives you the beat to re-attempt the question in your head, which is where
 * the learning is, but nothing blocks you from just looking.
 *
 * `showReveal` and `defaultRevealed` let a surface skip the button: a question
 * the student already got right has nothing to hide, so results show it revealed
 * with no button, while missed ones keep the re-attempt beat.
 */
export function QuestionReview({
  question,
  className,
  showReveal = true,
  defaultRevealed = false,
}: {
  question: ReviewQuestion;
  className?: string;
  /** Whether the "Reveal answer" button may appear (when still hidden). */
  showReveal?: boolean;
  /** Start with the answer already shown (e.g. a question answered correctly). */
  defaultRevealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(defaultRevealed);
  const options = (question.options as Opt[]) ?? [];
  const isMath = question.section === 'math';
  const isSpr = question.answerFormat === 'spr';

  return (
    <div className={className}>
      <QuestionFigure url={question.visualUrl} description={question.visualData} className="my-3" />

      {question.passage && (
        <div className="mb-3 whitespace-pre-line text-small leading-6 text-ink-500">
          <QText isMath={isMath}>{question.passage}</QText>
        </div>
      )}

      <div className="mb-3 text-body font-medium text-ink-900">
        <QText isMath={isMath}>{question.questionText}</QText>
      </div>

      {isSpr ? (
        <SprReview question={question} revealed={revealed} />
      ) : (
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
              <span className="flex-1">
                <QText isMath={isMath} block={false}>{opt.text}</QText>
              </span>
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
      )}

      {revealed ? (
        question.explanation && (
          <div className="mt-3 rounded-control bg-paper px-3 py-2.5">
            <p className="mb-1 text-micro font-medium uppercase tracking-wide text-ink-400">
              Why
            </p>
            <div className="whitespace-pre-line text-small leading-6 text-ink-700">
              <QText isMath={isMath}>{question.explanation}</QText>
            </div>
          </div>
        )
      ) : showReveal ? (
        <Button size="sm" className="mt-3" onClick={() => setRevealed(true)}>
          Reveal answer
          <Icon name="chevron-down" className="text-small" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A student-produced-response (grid-in) question in review: no choices, just
 * the answer the user typed and — after the reveal — the accepted answer(s).
 */
function SprReview({ question, revealed }: { question: ReviewQuestion; revealed: boolean }) {
  const your = question.yourAnswer?.trim();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 rounded-control border border-line px-3 py-2 text-small">
        <span className="text-micro font-medium uppercase tracking-wide text-ink-400">Your answer</span>
        <span className="font-mono text-ink-900">{your || '—'}</span>
      </div>
      {revealed && (
        <div className="flex items-baseline gap-2 rounded-control border border-green/50 bg-green-tint px-3 py-2 text-small">
          <span className="text-micro font-medium uppercase tracking-wide text-ink-400">Accepted</span>
          <span className="font-mono text-ink-900">{question.correctAnswer || '—'}</span>
        </div>
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
