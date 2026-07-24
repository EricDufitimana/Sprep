'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Segmented tabs — sliding well, keyboard navigable (arrow keys). */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  const id = useId();

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = items.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(items[(idx + 1) % items.length].value);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(items[(idx - 1 + items.length) % items.length].value);
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn('inline-flex items-center gap-1 rounded-control border border-line bg-sunken p-1', className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`${id}-${item.value}`}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'rounded-[7px] px-3 py-1 text-small font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
              active ? 'bg-surface text-ink-900 shadow-lift' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Uncontrolled convenience wrapper. */
export function useTabs<T extends string>(initial: T) {
  return useState<T>(initial);
}
