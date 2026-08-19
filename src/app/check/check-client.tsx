'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Stat } from '@/components/ui/stat';
import { domainLabel } from '@/lib/labels';
import type { BadgeTone } from '@/components/ui/badge';

/** How each match was found — shown as a small badge on every hit. */
const REASON: Record<'exact' | 'passage' | 'id', { label: string; tone: BadgeTone }> = {
  exact: { label: 'text match', tone: 'miss' },
  passage: { label: 'same passage', tone: 'amber' },
  id: { label: 'id match', tone: 'blue' },
};

/**
 * The `/check` dedupe screen.
 *
 * Paste a question-bank JSON → the server matches each item's TEXT (passage +
 * prompt, tag-insensitive) against the stored bank, with the id as a bonus
 * catch → we surface the overlap and hand back the JSON with the duplicates
 * removed, ready to copy.
 *
 * This page lives outside the dashboard shell (no sidebar), so it paints its
 * own paper/surface frame to stay in the design system.
 */
export function CheckClient() {
  const trpc = useTRPC();
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);

  const dedupe = useMutation(trpc.check.dedupe.mutationOptions());
  const result = dedupe.data;

  const run = () => {
    setCopied(false);
    dedupe.reset();
    dedupe.mutate({ raw });
  };

  const copyRemaining = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.remainingJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="min-h-dvh w-full bg-paper">
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-5 py-8 md:px-8 md:py-12">
        <PageHeader
          title="Question Check"
          description="Paste a question-bank JSON. Anything already in your bank — done before or from a Bluebook test — gets flagged and stripped out."
        />

        {/* Input card */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Paste JSON</CardTitle>
            {raw.trim() && (
              <button
                type="button"
                onClick={() => {
                  setRaw('');
                  dedupe.reset();
                }}
                className="text-small text-ink-500 transition-colors hover:text-ink-900"
              >
                Clear
              </button>
            )}
          </CardHeader>
          <CardBody className="space-y-3">
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              placeholder='[ { "questionId": "f1bfbed3", "external_id": "52a8f1cb-…", "stem": "…" }, … ]'
              className={cn(
                'h-64 w-full resize-y rounded-control border border-line bg-sunken/40 px-3.5 py-3',
                'font-mono text-small leading-relaxed text-ink-900 placeholder:text-ink-400',
                'outline-none transition-colors focus:border-blue focus:bg-surface',
                'focus:ring-2 focus:ring-blue/20',
              )}
            />

            {dedupe.isError && (
              <div className="flex items-start gap-2 rounded-control bg-miss-tint px-3.5 py-2.5 text-small text-miss">
                <Icon name="warning" className="mt-0.5 shrink-0" />
                <span>{dedupe.error.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-micro text-ink-400">
                Matched on the pure text of the passage &amp; prompt — tags and formatting
                ignored — plus <span className="font-mono">id</span> as a fallback.
              </p>
              <Button onClick={run} disabled={!raw.trim() || dedupe.isPending}>
                {dedupe.isPending ? (
                  <>
                    <Icon name="spinner-solid" className="animate-spin" />
                    Checking…
                  </>
                ) : (
                  <>
                    <Icon name="target" />
                    Check
                  </>
                )}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Results */}
        {result && (
          <Reveal className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Pasted" value={result.totalPasted} />
              <Stat label="Already in bank" value={result.matchedCount} tone="coral" />
              <Stat
                label="Active Bluebook"
                value={result.activeMatchCount}
                tone="amber"
                hint="of the matches, still live"
              />
              <Stat label="New (kept)" value={result.remainingCount} tone="green" />
              <Stat label="In bank total" value={result.totalStored} />
            </div>

            {result.noTextCount > 0 && (
              <div className="flex items-start gap-2 rounded-control bg-amber-tint px-3.5 py-2.5 text-small text-amber">
                <Icon name="warning" className="mt-0.5 shrink-0" />
                <span>
                  {result.noTextCount} item{result.noTextCount === 1 ? '' : 's'} had no readable
                  text or id to match on — they were kept in the output to be safe.
                </span>
              </div>
            )}

            {/* Matched list */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {result.matchedCount === 0
                    ? 'No duplicates found'
                    : `${result.matchedCount} already in your bank`}
                </CardTitle>
                {result.matchedCount > 0 && <Badge tone="miss">skip these</Badge>}
              </CardHeader>
              <CardBody>
                {result.matchedCount === 0 ? (
                  <div className="flex items-center gap-2 text-body text-green">
                    <Icon name="checkmark-circle" />
                    <span className="text-ink-700">
                      Nothing here overlaps your bank — every question is new.
                    </span>
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {result.matched.map((m) => (
                      <li key={m.index} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-miss-tint text-micro font-semibold text-miss">
                          {m.index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-body text-ink-900">
                            {m.preview || <span className="text-ink-400">— no text —</span>}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {m.stored.domain && (
                              <Badge tone="blue">{domainLabel(m.stored.domain)}</Badge>
                            )}
                            {m.stored.skill && <Badge tone="neutral">{m.stored.skill}</Badge>}
                            {m.stored.difficulty && (
                              <Badge tone="amber">{m.stored.difficulty}</Badge>
                            )}
                            {m.stored.isActive && <Badge tone="amber">active Bluebook</Badge>}
                            {m.stored.isDefault && <Badge tone="neutral">default bank</Badge>}
                            <Badge tone={REASON[m.reason].tone}>{REASON[m.reason].label}</Badge>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            {/* De-duplicated output */}
            <Card>
              <CardHeader>
                <CardTitle>De-duplicated JSON · {result.remainingCount} kept</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyRemaining}
                  disabled={result.remainingCount === 0}
                >
                  <Icon name={copied ? 'checkmark' : 'files'} />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </CardHeader>
              <CardBody>
                {result.remainingCount === 0 ? (
                  <p className="text-body text-ink-500">
                    Every pasted question was already in the bank — nothing left to keep.
                  </p>
                ) : (
                  <pre className="max-h-96 overflow-auto rounded-control border border-line bg-sunken/40 p-3.5 font-mono text-micro leading-relaxed text-ink-700">
                    {result.remainingJson}
                  </pre>
                )}
              </CardBody>
            </Card>
          </Reveal>
        )}
      </div>
    </div>
  );
}
