'use client';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

/** A selectable answer chip that reveals correct/wrong state after grading. */
export function OptionButton({
  label,
  selected,
  state,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  state: 'idle' | 'correct' | 'wrong';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex items-center justify-between gap-3 rounded-control border px-4 py-2.5 text-left text-body transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue disabled:cursor-default',
        state === 'correct' && 'border-green bg-green-tint text-green',
        state === 'wrong' && 'border-miss bg-miss-tint text-miss',
        state === 'idle' && (selected ? 'border-blue bg-blue-tint text-ink-900' : 'border-line bg-surface text-ink-700 hover:border-ink-400/40'),
      )}
    >
      <span>{label}</span>
      {state === 'correct' && <Icon name="checkmark-circle" className="text-small" />}
      {state === 'wrong' && <Icon name="cross-circle" className="text-small" />}
    </button>
  );
}

/** Running "N/M correct" line above an exercise. */
export function ScoreLine({ label, score }: { label: string; score: { correct: number; total: number } }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-small font-medium uppercase tracking-wide text-ink-400">{label}</p>
      {score.total > 0 && (
        <p className="text-small text-ink-500 tabular-nums">
          {score.correct}/{score.total} correct
        </p>
      )}
    </div>
  );
}

/** Inline error with a retry, styled like the rest of the app's alerts. */
export function ExerciseError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-6 text-center">
      <p role="alert" className="text-small text-miss">
        {message}
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        <Icon name="reload" className="text-small" />
        Try again
      </Button>
    </div>
  );
}
