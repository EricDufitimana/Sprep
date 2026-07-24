'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export interface TimerProps {
  /** Total seconds to count down from. */
  seconds: number;
  running: boolean;
  onExpire: () => void;
  className?: string;
}

function format(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Countdown timer. Turns amber under 5 minutes, miss-red under 1 minute. */
export function Timer({ seconds, running, onExpire, className }: TimerProps) {
  const [left, setLeft] = useState(seconds);
  const expired = useRef(false);

  useEffect(() => setLeft(seconds), [seconds]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          if (!expired.current) {
            expired.current = true;
            // Defer so we never set parent state mid-render.
            setTimeout(onExpire, 0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, onExpire]);

  const danger = left < 60;
  const warn = !danger && left < 300;

  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={`Time remaining ${format(left)}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-control border px-3 py-1.5 text-lead font-semibold tabular-nums',
        danger
          ? 'border-miss/40 bg-miss-tint text-miss'
          : warn
            ? 'border-amber/40 bg-amber-tint text-amber'
            : 'border-line bg-surface text-ink-900',
        className,
      )}
    >
      <Icon name="alarm-clock" className="text-base" />
      {format(left)}
    </div>
  );
}
