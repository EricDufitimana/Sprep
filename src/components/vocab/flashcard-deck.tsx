'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/utils';
import { ExerciseError } from './exercise-parts';

const CHARGE_TONE: Record<string, BadgeTone> = { positive: 'green', negative: 'miss', neutral: 'blue' };

type TypeFilter = 'all' | 'prefix' | 'root' | 'suffix';
type Mode = 'all' | 'missed';

interface MorphemeProgress {
  total: number;
  learned: number;
  seen: number;
  byGroup: { key: string; total: number; learned: number; seen: number }[];
}

const TYPE_CHIPS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prefix', label: 'Prefixes' },
  { value: 'root', label: 'Roots' },
  { value: 'suffix', label: 'Suffixes' },
];

/**
 * Part 1 of learning the morphemes: flashcards. See the piece, flip for its
 * meaning, then self-mark — check (I know it) or cross (still learning). Marks
 * are tracked with the same Leitner scheme as the Decode Trainer, so you can come
 * back and drill just the ones you didn't know. When the deck is done it hands
 * off to Part 2, the multiple-choice quiz.
 */
export function FlashcardDeck({ onContinue }: { onContinue?: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [mode, setMode] = useState<Mode>('all');
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [session, setSession] = useState({ reviewed: 0, knew: 0 });

  const deckInput = { type: typeFilter === 'all' ? undefined : typeFilter, mode };
  const deck = useQuery({
    ...trpc.vocabulary.flashcardDeck.queryOptions(deckInput),
    // Don't reshuffle the deck out from under an in-progress session on refocus.
    refetchOnWindowFocus: false,
  });
  const progress = useQuery(trpc.vocabulary.morphemeProgress.queryOptions());

  const review = useMutation(
    trpc.vocabulary.reviewFlashcard.mutationOptions({
      // The "Morphemes learned" bar is updated optimistically in answer(); only
      // re-sync from the server if a save actually fails.
      onError: () => {
        void queryClient.invalidateQueries(trpc.vocabulary.morphemeProgress.queryFilter());
      },
    }),
  );

  /** Immediately reflect a self-assessment in the learned counter (no round-trip). */
  const bumpProgress = (knew: boolean, c: { seen: boolean; learned: boolean; group: string }) => {
    const dSeen = c.seen ? 0 : 1;
    const dLearned = (knew ? 1 : 0) - (c.learned ? 1 : 0);
    if (dSeen === 0 && dLearned === 0) return;
    queryClient.setQueryData<MorphemeProgress>(
      trpc.vocabulary.morphemeProgress.queryOptions().queryKey,
      (old) => {
        if (!old) return old;
        return {
          ...old,
          seen: old.seen + dSeen,
          learned: old.learned + dLearned,
          byGroup: old.byGroup.map((g) =>
            g.key === c.group ? { ...g, seen: g.seen + dSeen, learned: g.learned + dLearned } : g,
          ),
        };
      },
    );
  };

  const resetSession = () => {
    setPos(0);
    setFlipped(false);
    setSession({ reviewed: 0, knew: 0 });
  };

  const switchTo = (next: Partial<{ type: TypeFilter; mode: Mode }>) => {
    if (next.type !== undefined) setTypeFilter(next.type);
    if (next.mode !== undefined) setMode(next.mode);
    resetSession();
  };

  const restart = () => {
    resetSession();
    void deck.refetch();
  };

  if (deck.isLoading) {
    return <div className="h-80 animate-pulse rounded-card border border-line bg-sunken/50" />;
  }
  if (deck.isError || !deck.data) {
    return <ExerciseError message={deck.error?.message ?? 'Could not load flashcards.'} onRetry={() => deck.refetch()} />;
  }

  const cards = deck.data;
  const p = progress.data;
  const learnedPct = p && p.total > 0 ? Math.round((p.learned / p.total) * 100) : 0;
  const missedCount = p ? Math.max(0, p.seen - p.learned) : 0;

  const typeChips = (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {TYPE_CHIPS.map((c) => (
        <button
          key={c.value}
          onClick={() => switchTo({ type: c.value, mode: 'all' })}
          aria-pressed={typeFilter === c.value && mode === 'all'}
          className={cn(
            'rounded-pill border px-3 py-1 text-small transition-colors',
            typeFilter === c.value && mode === 'all'
              ? 'border-blue bg-blue-tint text-ink-900'
              : 'border-line text-ink-600 hover:border-ink-400/40',
          )}
        >
          {c.label}
        </button>
      ))}
      <button
        onClick={() => switchTo({ mode: 'missed' })}
        aria-pressed={mode === 'missed'}
        disabled={missedCount === 0}
        className={cn(
          'rounded-pill border px-3 py-1 text-small transition-colors disabled:cursor-default disabled:opacity-40',
          mode === 'missed' ? 'border-amber bg-amber-tint text-ink-900' : 'border-line text-ink-600 hover:border-ink-400/40',
        )}
      >
        Review missed{missedCount > 0 ? ` (${missedCount})` : ''}
      </button>
    </div>
  );

  const header = (
    <div className="space-y-3">
      <LearnedHeader learned={p?.learned ?? 0} total={p?.total ?? cards.length} pct={learnedPct} />
      {typeChips}
    </div>
  );

  // ── Empty (e.g. "Review missed" with nothing outstanding) ──
  if (cards.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          icon="checkmark-circle"
          title={mode === 'missed' ? 'Nothing to review' : 'No cards here'}
          description={
            mode === 'missed'
              ? "You're not carrying any 'still learning' cards in this set — nice."
              : 'No morphemes match this filter yet.'
          }
          action={
            onContinue ? (
              <Button onClick={onContinue}>
                Go to the quiz
                <Icon name="arrow-right" className="text-small" />
              </Button>
            ) : (
              <span className="text-small text-ink-400">Pick another set above</span>
            )
          }
        />
      </div>
    );
  }

  // ── Session complete ──
  if (pos >= cards.length) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <CardBody className="space-y-4 text-center">
            <Icon name="checkmark-circle" className="mx-auto text-h1 text-green" label="Done" />
            <div>
              <h3 className="text-h3 font-semibold text-ink-900">
                {mode === 'missed' ? 'Review complete' : 'Deck complete'}
              </h3>
              <p className="text-small text-ink-500">
                You reviewed {session.reviewed} card{session.reviewed === 1 ? '' : 's'} and knew{' '}
                <span className="font-medium text-ink-700">{session.knew}</span> of them.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {mode === 'all' && missedCount > 0 && (
                <Button onClick={() => switchTo({ mode: 'missed' })}>
                  <Icon name="reload" className="text-small" />
                  Review the {missedCount} you didn&apos;t know
                </Button>
              )}
              <Button variant={mode === 'all' && missedCount > 0 ? 'ghost' : 'primary'} onClick={restart}>
                <Icon name="reload" className="text-small" />
                Study again
              </Button>
              {onContinue && (
                <Button variant="ghost" onClick={onContinue}>
                  Multiple-choice quiz
                  <Icon name="arrow-right" className="text-small" />
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const card = cards[pos];
  const answer = (knew: boolean) => {
    bumpProgress(knew, card); // optimistic — the bar moves the instant you answer
    review.mutate({ morphemeId: card.id, knew });
    setSession((s) => ({ reviewed: s.reviewed + 1, knew: s.knew + (knew ? 1 : 0) }));
    setPos((i) => i + 1);
    setFlipped(false);
  };

  return (
    <div className="space-y-5">
      {header}

      <div className="flex items-center justify-between text-small text-ink-500">
        <span className="tabular-nums">
          Card {pos + 1} of {cards.length}
        </span>
        <div className="flex items-center gap-2">
          {card.learned && <Badge tone="green">learned</Badge>}
          {!card.seen && <Badge tone="neutral">new</Badge>}
        </div>
      </div>

      <Reveal key={card.id}>
        <Card>
          <CardBody className="min-h-[18rem] space-y-5">
            <div className="flex items-start justify-between gap-3">
              <span className="accent-serif text-h1 text-ink-900">{card.text}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone="neutral">{card.type}</Badge>
                {card.charge && <Badge tone={CHARGE_TONE[card.charge]}>{card.charge}</Badge>}
              </div>
            </div>

            {!flipped ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
                <p className="text-small text-ink-400">What does this piece mean?</p>
                <Button variant="ghost" onClick={() => setFlipped(true)}>
                  Show meaning
                  <Icon name="arrow-right" className="text-small" />
                </Button>
              </div>
            ) : (
              <Reveal className="space-y-4">
                <div>
                  <p className="text-micro uppercase tracking-wide text-ink-400">Meaning</p>
                  <p className="mt-0.5 text-h3 text-ink-900">{card.meaning}</p>
                </div>

                {card.exampleWords.length > 0 && (
                  <div>
                    <p className="text-micro uppercase tracking-wide text-ink-400">Shows up in</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {card.exampleWords.map((w) => (
                        <span key={w} className="rounded-pill bg-sunken px-2 py-0.5 text-micro text-ink-500">
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Button variant="ghost" disabled={review.isPending} onClick={() => answer(false)}>
                    <Icon name="cross-circle" className="text-small text-miss" />
                    Still learning
                  </Button>
                  <Button disabled={review.isPending} onClick={() => answer(true)}>
                    <Icon name="checkmark-circle" className="text-small" />
                    I knew it
                  </Button>
                </div>
              </Reveal>
            )}
          </CardBody>
        </Card>
      </Reveal>
    </div>
  );
}

function LearnedHeader({ learned, total, pct }: { learned: number; total: number; pct: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-small font-medium text-ink-700">Morphemes learned</p>
        <p className="text-small tabular-nums text-ink-500">
          {learned} <span className="text-ink-400">/ {total}</span>
        </p>
      </div>
      <ProgressBar value={pct} tone={pct >= 80 ? 'green' : pct >= 40 ? 'amber' : 'blue'} label="Morphemes learned" />
    </div>
  );
}
