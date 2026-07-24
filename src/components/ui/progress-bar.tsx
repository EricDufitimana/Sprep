import { cn } from '@/lib/utils';

export type ProgressTone = 'blue' | 'green' | 'amber' | 'coral' | 'miss';

export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  tone?: ProgressTone;
  className?: string;
  label?: string;
}

const tones: Record<ProgressTone, string> = {
  blue: 'bg-blue',
  green: 'bg-green',
  amber: 'bg-amber',
  coral: 'bg-coral',
  miss: 'bg-miss',
};

export function ProgressBar({ value, tone = 'blue', className, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-sunken', className)}
    >
      <div
        className={cn('h-full rounded-pill transition-[width] duration-300 ease-out', tones[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
