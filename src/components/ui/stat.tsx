'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { motion } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { Card } from './card';

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type StatTone = 'plain' | 'amber' | 'violet' | 'green' | 'blue' | 'coral';

export interface StatProps {
  label: string;
  value: number;
  /** Rendered after the number, e.g. "%" */
  suffix?: string;
  /** Small line under the value, e.g. "+7 pts vs last month" */
  hint?: string;
  hintTone?: 'up' | 'down' | 'neutral';
  /** Pastel color-block background; 'plain' keeps the bordered white card. */
  tone?: StatTone;
  className?: string;
}

const tones: Record<StatTone, string> = {
  plain: '',
  amber: 'border-transparent bg-amber-tint',
  violet: 'border-transparent bg-violet-tint',
  green: 'border-transparent bg-green-tint',
  blue: 'border-transparent bg-blue-tint',
  coral: 'border-transparent bg-coral-tint',
};

/** Stat card with a GSAP count-up. Static under prefers-reduced-motion. */
export function Stat({ label, value, suffix = '', hint, hintTone = 'neutral', tone = 'plain', className }: StatProps) {
  const numRef = useRef<HTMLSpanElement>(null);

  useIsoLayoutEffect(() => {
    const el = numRef.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const counter = { n: 0 };
      gsap.to(counter, {
        n: value,
        duration: motion.slow * 2,
        ease: 'power3.out',
        onUpdate: () => {
          el.textContent = String(Math.round(counter.n));
        },
      });
    });
    return () => mm.revert();
  }, [value]);

  return (
      <Card className={cn('px-5 py-4', tones[tone], className)}>
        <p className={cn('text-small', tone === 'plain' ? 'text-ink-500' : 'text-ink-700')}>{label}</p>
        <p className="mt-1 text-h1 font-semibold text-ink-900 tabular-nums">
          <span ref={numRef}>{value}</span>
          {suffix && <span className="text-h3 text-ink-500">{suffix}</span>}
        </p>
        {hint && (
          <p
            className={cn(
              'mt-1 text-micro',
              hintTone === 'up' && 'text-green',
              hintTone === 'down' && 'text-miss',
              hintTone === 'neutral' && 'text-ink-400',
            )}
          >
            {hint}
          </p>
        )}
      </Card>

  );
}
