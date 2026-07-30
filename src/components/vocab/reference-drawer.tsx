'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { CHARGE_TONE, GROUP_ORDER, groupLabel } from './labels';

/**
 * Persistent, collapsible roots/prefixes reference — so a user can look a piece
 * up mid-session before they've memorized it. Reads the shared morpheme corpus,
 * grouped by meaning-family.
 */
export function ReferenceDrawer({ highlightGroup }: { highlightGroup?: string | null }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const morphemes = useQuery(trpc.vocabulary.listMorphemes.queryOptions(undefined, { enabled: open }));

  const groups = [...(morphemes.data ?? [])].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.group);
    const bi = GROUP_ORDER.indexOf(b.group);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-small font-medium text-ink-700">
          <Icon name="library" className="text-small text-ink-400" />
          Roots &amp; prefixes reference
        </span>
        <Icon name="chevron-down" className={cn('text-small text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="max-h-80 space-y-4 overflow-y-auto border-t border-line px-4 py-3">
          {morphemes.isLoading ? (
            <div className="h-40 animate-pulse rounded-control bg-sunken/50" />
          ) : (
            groups.map((g) => (
              <div key={g.group} className={cn('rounded-control', highlightGroup === g.group && 'bg-amber-tint/40 p-2')}>
                <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-ink-400">{groupLabel(g.group)}</p>
                <ul className="space-y-1">
                  {g.morphemes.map((m) => (
                    <li key={m.id} className="flex items-baseline gap-2 text-small">
                      <span className="accent-serif min-w-16 shrink-0 font-semibold text-ink-900">{m.text}</span>
                      <span className="text-ink-600">{m.meaning}</span>
                      {m.charge && <Badge tone={CHARGE_TONE[m.charge]}>{m.charge}</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
