'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/utils';
import { vocabularyWordSchema, type WordCharge } from '@/lib/validation';

const CHARGE_TONE: Record<WordCharge, BadgeTone> = { positive: 'green', negative: 'miss', neutral: 'blue' };
const CHARGES: WordCharge[] = ['positive', 'neutral', 'negative'];

type BankHit = {
  id: string;
  word: string;
  sentence: string | null;
  definition: string | null;
  root: string | null;
  charge: WordCharge | null;
  part_of_speech: string | null;
};

type MyWord = {
  id: string;
  set_id: string | null;
  word: string;
  sentence: string | null;
  definition: string | null;
  root: string | null;
  charge: WordCharge | null;
  part_of_speech: string | null;
  created_at: string;
};

const emptyForm = {
  word: '',
  sentence: '',
  definition: '',
  root: '',
  charge: 'neutral' as WordCharge,
  part_of_speech: '',
};
type Form = typeof emptyForm;

/** Debounce a changing value so the bank search fires on a pause, not per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * "My words" — build a personal deck of the words you keep running into.
 *
 * Type the word and it prefix-searches the shared SAT corpus; pick a match and
 * the definition, sentence, root, charge and part-of-speech prefill so you can
 * save in one click, or fill them in yourself for a word the bank doesn't have.
 * Saved words become a flashcard deck that's entirely your own, kept separate
 * from the built-in morpheme cards.
 */
export function MyWords() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const words = useQuery(trpc.vocabularyManagement.listWords.queryOptions({}));

  return (
    <div className="space-y-8">
      <AddWordCard
        onSaved={() => {
          void queryClient.invalidateQueries(trpc.vocabularyManagement.listWords.queryFilter({}));
        }}
      />

      {words.isLoading ? (
        <div className="h-72 animate-pulse rounded-card border border-line bg-sunken/50" />
      ) : (words.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="library"
          title="No words of your own yet"
          description="Add a word above — search the bank to prefill it, or type your own. It'll show up here as a flashcard."
          action={<span className="text-small text-ink-400">Start with a word you keep forgetting.</span>}
        />
      ) : (
        <MyWordsDeck
          words={(words.data ?? []) as MyWord[]}
          onDeleted={() => {
            void queryClient.invalidateQueries(trpc.vocabularyManagement.listWords.queryFilter({}));
          }}
        />
      )}
    </div>
  );
}

// ── Add form with bank autocomplete ─────────────────────────────────────────

function AddWordCard({ onSaved }: { onSaved: () => void }) {
  const trpc = useTRPC();
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // Suppress the dropdown right after a pick or a fresh reset, so it doesn't
  // reopen over a field the user just filled from the bank.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const debouncedWord = useDebounced(form.word, 250);
  const search = useQuery({
    ...trpc.vocabularyManagement.searchBank.queryOptions({ query: debouncedWord }),
    enabled: showSuggestions && debouncedWord.trim().length >= 2,
  });

  const create = useMutation(
    trpc.vocabularyManagement.createWord.mutationOptions({
      onSuccess: (res) => {
        setJustSaved(res.word.word);
        setForm(emptyForm);
        setShowSuggestions(false);
        setPrefilledFrom(null);
        setError(null);
        onSaved();
      },
      onError: (e) => setError(e.message || 'Could not save the word'),
    }),
  );

  // Close the dropdown when clicking outside the form.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const setField = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const pickSuggestion = (hit: BankHit) => {
    setForm({
      word: hit.word,
      sentence: hit.sentence ?? '',
      definition: hit.definition ?? '',
      root: hit.root ?? '',
      charge: hit.charge ?? 'neutral',
      part_of_speech: hit.part_of_speech ?? '',
    });
    setPrefilledFrom(hit.word);
    setShowSuggestions(false);
    setError(null);
  };

  const submit = () => {
    setJustSaved(null);
    const parsed = vocabularyWordSchema.safeParse({
      word: form.word.trim(),
      sentence: form.sentence.trim(),
      definition: form.definition.trim(),
      root: form.root.trim(),
      charge: form.charge,
      part_of_speech: form.part_of_speech.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please fill in the required fields');
      return;
    }
    create.mutate({ ...parsed.data, setId: null });
  };

  const hits = (search.data ?? []) as BankHit[];
  const showDropdown = showSuggestions && debouncedWord.trim().length >= 2 && (search.isLoading || hits.length > 0);

  return (
    <div ref={boxRef}>
      <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="text-body font-semibold text-ink-900">Add a word</h2>
          <p className="text-small text-ink-500">
            Start typing — matches from the word bank prefill the rest. No match? Just fill it in yourself.
          </p>
        </div>

        {/* Word + autocomplete */}
        <div className="relative">
          <Input
            label="Word"
            placeholder="e.g. aberration"
            value={form.word}
            autoComplete="off"
            onChange={(e) => {
              setField('word', e.target.value);
              setShowSuggestions(true);
              setPrefilledFrom(null);
            }}
            onFocus={() => setShowSuggestions(true)}
          />
          {showDropdown && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-lg">
              {search.isLoading && hits.length === 0 ? (
                <li className="px-3 py-2 text-small text-ink-400">Searching the bank…</li>
              ) : (
                hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => pickSuggestion(hit)}
                      className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-sunken/60"
                    >
                      <span className="truncate">
                        <span className="text-body text-ink-900">{hit.word}</span>
                        {hit.definition && (
                          <span className="ml-2 text-small text-ink-500">— {hit.definition}</span>
                        )}
                      </span>
                      {hit.charge && (
                        <Badge tone={CHARGE_TONE[hit.charge]} className="shrink-0">
                          {hit.charge}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {prefilledFrom && (
            <p className="mt-1 text-micro text-green">
              Prefilled from the bank — tweak anything, then save.
            </p>
          )}
        </div>

        <Textarea
          label="Sentence (the word in context)"
          placeholder="Use the word in a full sentence — at least three words."
          rows={2}
          value={form.sentence}
          onChange={(e) => setField('sentence', e.target.value)}
        />

        <Textarea
          label="Definition"
          placeholder="What it means, in your own words."
          rows={2}
          value={form.definition}
          onChange={(e) => setField('definition', e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Root (optional)"
            placeholder="e.g. errare — to wander"
            value={form.root}
            onChange={(e) => setField('root', e.target.value)}
          />
          <Input
            label="Part of speech (optional)"
            placeholder="e.g. noun"
            value={form.part_of_speech}
            onChange={(e) => setField('part_of_speech', e.target.value)}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-small font-medium text-ink-700">Charge</span>
          <div className="flex flex-wrap gap-1.5">
            {CHARGES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setField('charge', c)}
                aria-pressed={form.charge === c}
                className={cn(
                  'rounded-pill border px-3 py-1 text-small capitalize transition-colors',
                  form.charge === c
                    ? 'border-blue bg-blue-tint text-ink-900'
                    : 'border-line text-ink-600 hover:border-ink-400/40',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-small text-miss">
            {error}
          </p>
        )}
        {justSaved && !error && (
          <p className="text-small text-green">
            Saved <span className="font-medium">{justSaved}</span> to your deck.
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={create.isPending || form.word.trim().length === 0}>
            <Icon name="plus" className="text-small" />
            {create.isPending ? 'Saving…' : 'Add to my words'}
          </Button>
        </div>
      </CardBody>
      </Card>
    </div>
  );
}

// ── Flashcard deck over the user's own words ────────────────────────────────

function MyWordsDeck({ words, onDeleted }: { words: MyWord[]; onDeleted: () => void }) {
  const trpc = useTRPC();
  const [order, setOrder] = useState<string[]>(() => words.map((w) => w.id));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Keep the shuffled order in sync as words are added/removed, without
  // reshuffling the deck out from under the current session.
  useEffect(() => {
    setOrder((prev) => {
      const ids = new Set(words.map((w) => w.id));
      const kept = prev.filter((id) => ids.has(id));
      const added = words.map((w) => w.id).filter((id) => !prev.includes(id));
      return [...added, ...kept];
    });
  }, [words]);

  const byId = useMemo(() => new Map(words.map((w) => [w.id, w])), [words]);
  const deck = order.map((id) => byId.get(id)).filter((w): w is MyWord => !!w);

  const del = useMutation(
    trpc.vocabularyManagement.deleteWord.mutationOptions({
      onSuccess: onDeleted,
    }),
  );

  const safePos = deck.length === 0 ? 0 : Math.min(pos, deck.length - 1);
  const card = deck[safePos];

  const go = (delta: number) => {
    setFlipped(false);
    setPos((i) => {
      if (deck.length === 0) return 0;
      return (i + delta + deck.length) % deck.length;
    });
  };

  const shuffle = () => {
    setOrder((prev) => {
      const a = [...prev];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
    setPos(0);
    setFlipped(false);
  };

  if (!card) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-body font-semibold text-ink-900">My flashcards</h2>
          <p className="text-small text-ink-500">
            {deck.length} word{deck.length === 1 ? '' : 's'} you&apos;re tracking.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={shuffle} disabled={deck.length < 2}>
          <Icon name="reload" className="text-small" />
          Shuffle
        </Button>
      </div>

      <div className="flex items-center justify-between text-small text-ink-500">
        <span className="tabular-nums">
          Card {safePos + 1} of {deck.length}
        </span>
        <div className="flex items-center gap-1.5">
          {card.part_of_speech && <Badge tone="neutral">{card.part_of_speech}</Badge>}
          {card.charge && <Badge tone={CHARGE_TONE[card.charge]}>{card.charge}</Badge>}
        </div>
      </div>

      <Reveal key={card.id}>
        <Card>
          <CardBody className="min-h-[16rem] space-y-5">
            <div className="flex items-start justify-between gap-3">
              <span className="accent-serif text-h1 text-ink-900">{card.word}</span>
            </div>

            {!flipped ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
                <p className="text-small text-ink-400">What does it mean?</p>
                <Button variant="ghost" onClick={() => setFlipped(true)}>
                  Show meaning
                  <Icon name="arrow-right" className="text-small" />
                </Button>
              </div>
            ) : (
              <Reveal className="space-y-4">
                <div>
                  <p className="text-micro uppercase tracking-wide text-ink-400">Definition</p>
                  <p className="mt-0.5 text-h3 text-ink-900">{card.definition}</p>
                </div>
                {card.sentence && (
                  <div>
                    <p className="text-micro uppercase tracking-wide text-ink-400">In context</p>
                    <p className="mt-0.5 text-body italic text-ink-600">“{card.sentence}”</p>
                  </div>
                )}
                {card.root && (
                  <div>
                    <p className="text-micro uppercase tracking-wide text-ink-400">Root</p>
                    <p className="mt-0.5 text-body text-ink-700">{card.root}</p>
                  </div>
                )}
              </Reveal>
            )}
          </CardBody>
        </Card>
      </Reveal>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => go(-1)} disabled={deck.length < 2}>
          <Icon name="arrow-left" className="text-small" />
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => del.mutate({ wordId: card.id })}
          disabled={del.isPending}
        >
          <Icon name="trash-can" className="text-small text-miss" />
          Remove
        </Button>
        <Button variant="ghost" size="sm" onClick={() => go(1)} disabled={deck.length < 2}>
          Next
          <Icon name="arrow-right" className="text-small" />
        </Button>
      </div>
    </div>
  );
}
