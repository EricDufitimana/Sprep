'use client';

import { cn } from '@/lib/utils';
import { Icon, type IconName } from '@/components/ui/icon';
import type { Charge } from '@/lib/types';

export interface ChargePickerProps {
  value: Charge | null;
  onChange: (charge: Charge) => void;
  disabled?: boolean;
}

const OPTIONS: { charge: Charge; label: string; icon: IconName; active: string }[] = [
  { charge: 'positive', label: 'Positive', icon: 'plus', active: 'border-green bg-green-tint text-green' },
  { charge: 'negative', label: 'Negative', icon: 'minus', active: 'border-miss bg-miss-tint text-miss' },
  { charge: 'neutral', label: 'Neutral', icon: 'target', active: 'border-blue bg-blue-tint text-blue' },
];

/** Commit a charge guess: is this word +, –, or neutral in tone? */
export function ChargePicker({ value, onChange, disabled = false }: ChargePickerProps) {
  return (
    <div role="radiogroup" aria-label="Word charge" className="flex gap-2">
      {OPTIONS.map((opt) => {
        const selected = value === opt.charge;
        return (
          <button
            key={opt.charge}
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.charge)}
            className={cn(
              'flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-small font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue disabled:opacity-45',
              selected ? opt.active : 'border-line bg-surface text-ink-500 hover:text-ink-900',
            )}
          >
            <Icon name={opt.icon} className="text-micro" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
