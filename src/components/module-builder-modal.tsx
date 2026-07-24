'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';
import { domainLabel } from '@/lib/labels';
import { DSAT_MODULE_QUESTIONS } from '@/lib/dsat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Tabs } from '@/components/ui/tabs';

interface BankOption {
  id: string;
  name: string;
  is_default: boolean;
  counts: { verified: number };
}

interface ModuleBuilderModalProps {
  open: boolean;
  onClose: () => void;
  banks: BankOption[];
  onCreated: (moduleId: string) => void;
}

type Format = 'dsat' | 'custom';

const FORMAT_TABS = [
  { value: 'dsat' as const, label: 'DSAT Standard' },
  { value: 'custom' as const, label: 'Custom' },
];

/**
 * Compose a module from several banks.
 *
 * The preview is the point: it runs the real balancer server-side against the
 * user's *unseen* pool as they change inputs, so what they see here is exactly
 * what a sitting will draw. Nothing is guessed client-side.
 */
export function ModuleBuilderModal({ open, onClose, banks, onCreated }: ModuleBuilderModalProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Format>('dsat');
  const [total, setTotal] = useState(DSAT_MODULE_QUESTIONS);
  const [customCounts, setCustomCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const usable = banks.filter((b) => b.counts.verified > 0);
  const bankIds = useMemo(() => Array.from(selected), [selected]);

  // Live balance preview against the unseen pool.
  const preview = useQuery({
    ...trpc.modulesManagement.previewBalance.queryOptions({
      bankIds,
      format,
      total,
      customCounts: format === 'custom' ? customCounts : undefined,
    }),
    enabled: open && bankIds.length > 0,
  });

  // When the available domains change, seed custom counts from availability.
  const availableKey = JSON.stringify(preview.data?.available ?? {});
  useEffect(() => {
    if (format !== 'custom' || !preview.data) return;
    setCustomCounts((prev) => {
      const next: Record<string, number> = {};
      for (const [d, avail] of Object.entries(preview.data!.available)) {
        // Default a domain's count to half its pool, but never zero.
        next[d] = prev[d] ?? (Math.round(avail / 2) || avail);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableKey, format]);

  const create = useMutation(
    trpc.modulesManagement.create.mutationOptions({
      onSuccess: async (res) => {
        await queryClient.invalidateQueries();
        onCreated(res.moduleId);
        reset();
      },
      onError: (e) => setError(e.message),
    }),
  );

  const reset = () => {
    setName('');
    setSelected(new Set());
    setFormat('dsat');
    setTotal(DSAT_MODULE_QUESTIONS);
    setCustomCounts({});
    setError(null);
  };

  const close = () => {
    if (create.isPending) return;
    reset();
    onClose();
  };

  const toggleBank = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError('Give the module a name.');
    if (bankIds.length === 0) return setError('Pick at least one bank.');
    create.mutate({
      name: name.trim(),
      bankIds,
      format,
      total,
      customCounts: format === 'custom' ? customCounts : undefined,
    });
  };

  const planTotal = preview.data?.total ?? 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Build a module"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending || planTotal === 0}>
            {create.isPending ? 'Saving…' : `Create · ${planTotal} questions`}
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Input
          label="Module name"
          placeholder="e.g. Reading & Writing — Module 1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {/* Bank picker */}
        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Draw from these banks</p>
          {usable.length === 0 ? (
            <p className="rounded-control bg-amber-tint px-3 py-2 text-small text-ink-700">
              No banks with verified questions yet — upload a paper first.
            </p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {usable.map((b) => {
                const on = selected.has(b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => toggleBank(b.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-control border px-3 py-2 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                      on ? 'border-blue bg-blue-tint' : 'border-line hover:border-ink-400/50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border',
                        on ? 'border-blue bg-blue text-white' : 'border-ink-400',
                      )}
                    >
                      {on && <Icon name="checkmark" className="text-[10px]" />}
                    </span>
                    <span className="flex-1 truncate text-small text-ink-900">{b.name}</span>
                    {b.is_default && <Badge className="bg-white/70 text-ink-700">Built-in</Badge>}
                    <span className="shrink-0 text-micro text-ink-400 tabular-nums">
                      {b.counts.verified}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Format */}
        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Balance</p>
          <Tabs items={FORMAT_TABS} value={format} onChange={setFormat} className="w-full" />
          <p className="mt-1.5 text-micro text-ink-400">
            {format === 'dsat'
              ? 'Matches the official Reading & Writing domain mix, adjusted to fit what your banks contain.'
              : 'Set exactly how many questions come from each domain.'}
          </p>
        </div>

        {format === 'dsat' ? (
          <Input
            label="Total questions"
            type="number"
            min={1}
            max={120}
            value={total}
            onChange={(e) => setTotal(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
            hint="27 is one standard module. Tweak as you like."
            className="max-w-[10rem]"
          />
        ) : (
          bankIds.length > 0 &&
          preview.data && (
            <div className="space-y-2">
              <p className="text-small font-medium text-ink-700">Questions per domain</p>
              {Object.keys(preview.data.available).length === 0 ? (
                <p className="text-small text-ink-400">No questions in the selected banks.</p>
              ) : (
                Object.entries(preview.data.available).map(([domain, avail]) => (
                  <div key={domain} className="flex items-center justify-between gap-3">
                    <span className="text-small text-ink-700">{domainLabel(domain)}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={avail}
                        value={customCounts[domain] ?? 0}
                        onChange={(e) =>
                          setCustomCounts((prev) => ({
                            ...prev,
                            [domain]: Math.max(0, Math.min(avail, Number(e.target.value) || 0)),
                          }))
                        }
                        className="h-8 w-16 rounded-control border border-line px-2 text-right text-small text-ink-900 focus:outline-none focus:ring-2 focus:ring-blue"
                      />
                      <span className="w-14 text-micro text-ink-400 tabular-nums">of {avail}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )
        )}

        {/* Live preview */}
        {bankIds.length > 0 && (
          <div className="rounded-control bg-paper px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-small font-medium text-ink-700">This module</p>
              <span className="text-small text-ink-900 tabular-nums">
                {preview.isFetching ? '…' : `${planTotal} question${planTotal === 1 ? '' : 's'}`}
              </span>
            </div>
            {preview.data && Object.keys(preview.data.plan).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(preview.data.plan).map(([domain, n]) => (
                  <Badge key={domain} tone="blue">
                    {domainLabel(domain)}: {n}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-small text-ink-400">
                {preview.isFetching ? 'Balancing…' : 'Nothing to draw — every question may already be seen.'}
              </p>
            )}
            {preview.data?.notes?.map((note) => (
              <p key={note} className="mt-2 flex items-start gap-1.5 text-micro text-ink-500">
                <Icon name="warning" className="mt-0.5 text-amber" />
                {note}
              </p>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
