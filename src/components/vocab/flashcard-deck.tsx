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
import { ExerciseError } from './exercise-parts';

const CHARGE_TONE: Record<string, BadgeTone> = { positive: 'green', negative: 'miss', neutral: 'blue' };

/**
 * Flashcards for the morpheme corpus. Flip a card to check yourself, then mark
 * "knew it" / "still learning" — the same Leitner scheme as the Decode Trainer,
 * so learned pieces settle and shaky ones keep coming back. The header tracks how
 * much of the corpus is learned overall.
 */
export function FlashcardDeck() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const deck = useQuery(trpc.vocabulary.flashcardDeck.queryOptions({}));
  const progress = useQuery(trpc.vocabulary.morphemeProgress.queryOptions());

  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [session, setSession] = useState({ reviewed: 0, knew: 0 });

  const review = useMutation(
    trpc.vocabulary.reviewFlashcard.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.vocabulary.morphemeProgress.queryFilter());
      },
    }),
  );

  const restart = () => {
    setPos(0);
    setFlipped(false);
    setSession({ reviewed: 0, knew: 0 });
    void deck.refetch();
  };

  if (deck.isLoading) {
    return <div className="h-80 animate-pulse rounded-card border border-line bg-sunken/50" />;
  }
  if (deck.isError || !deck.data) {
    return <ExerciseError message={deck.error?.message ?? 'Could not load flashcards.'} onRetry={() => deck.refetch()} />;
  }

  const cards = deck.data;
  if (cards.length === 0) {
    return (
      <EmptyState
        icon="book"
        title="No morphemes to study yet"
        description="Run the vocabulary seed to load the roots, prefixes, and suffixes."
        action={<span className="text-small text-ink-400">npm run seed:vocab</span>}
      />
    );
  }

  const p = progress.data;
  const learnedPct = p && p.total > 0 ? Math.round((p.learned / p.total) * 100) : 0;

  // ── Session complete ──
  if (pos >= cards.length) {
    return (
      <div className="space-y-5">
        <LearnedHeader learned={p?.learned ?? 0} total={p?.total ?? cards.length} pct={learnedPct} />
        <Card>
          <CardBody className="space-y-4 text-center">
            <Icon name="checkmark-circle" className="mx-auto text-h1 text-green" label="Done" />
            <div>
              <h3 className="text-h3 font-semibold text-ink-900">Deck complete</h3>
              <p className="text-small text-ink-500">
                You reviewed {session.reviewed} card{session.reviewed === 1 ? '' : 's'} and knew{' '}
                <span className="font-medium text-ink-700">{session.knew}</span> of them.
              </p>
            </div>
            <div className="flex justify-center">
              <Button onClick={restart}>
                <Icon name="reload" className="text-small" />
                Study again
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const card = cards[pos];
  const answer = (knew: boolean) => {
    review.mutate({ morphemeId: card.id, knew });
    setSession((s) => ({ reviewed: s.reviewed + 1, knew: s.knew + (knew ? 1 : 0) }));
    setPos((i) => i + 1);
    setFlipped(false);
  };

  return (
    <div className="space-y-5">
      <LearnedHeader learned={p?.learned ?? 0} total={p?.total ?? cards.length} pct={learnedPct} />

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
                    <Icon name="reload" className="text-small" />
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
