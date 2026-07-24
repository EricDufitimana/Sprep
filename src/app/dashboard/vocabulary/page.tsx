'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { ChargePicker } from '@/components/charge-picker';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';
import type { Charge } from '@/lib/types';

/** Bold the target word inside its sentence. */
function Highlighted({ sentence, word }: { sentence: string; word: string }) {
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, idx)}
      <mark className="rounded-sm bg-blue-tint px-1 font-semibold text-blue">
        {sentence.slice(idx, idx + word.length)}
      </mark>
      {sentence.slice(idx + word.length)}
    </>
  );
}

const CHARGE_LABEL: Record<Charge, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

interface Reveal_ {
  chargeCorrect: boolean;
  actualCharge: Charge | null;
  definition: string | null;
  root: string | null;
}

export default function VocabularyPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const words = useQuery(trpc.vocabularyManagement.listWords.queryOptions({}));

  const [index, setIndex] = useState(0);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [guess, setGuess] = useState('');
  const [revealed, setRevealed] = useState<Reveal_ | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = useMutation(
    trpc.vocabularyManagement.recordAttempt.mutationOptions({
      onSuccess: (res) => {
        setRevealed(res);
        if (res.chargeCorrect) setCorrectCount((c) => c + 1);
        void queryClient.invalidateQueries();
      },
      onError: (e) => setError(e.message),
    }),
  );

  const list = words.data ?? [];
  const entry = list[index];
  const done = list.length > 0 && index >= list.length;

  const next = () => {
    setIndex((i) => i + 1);
    setCharge(null);
    setGuess('');
    setRevealed(null);
    setError(null);
  };

  const restart = () => {
    setIndex(0);
    setCharge(null);
    setGuess('');
    setRevealed(null);
    setCorrectCount(0);
  };

  return (
    <>
      <PageHeader
        title="Vocabulary"
        description="Decode words from context — commit a guess before you see the answer."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Icon name="plus" className="text-small" />
          Add a word
        </Button>
      </PageHeader>

      {words.isLoading ? (
        <div className="mx-auto h-64 max-w-2xl animate-pulse rounded-card border border-line bg-sunken/50" />
      ) : list.length === 0 ? (
        <EmptyState
          icon="book"
          title="No words yet"
          description="Add words you keep tripping over. Each one gets drilled in context — you commit a charge and a meaning before the definition shows."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Icon name="plus" className="text-small" />
              Add your first word
            </Button>
          }
        />
      ) : (
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center gap-4">
            <ProgressBar value={(Math.min(index, list.length) / list.length) * 100} label="Set progress" className="flex-1" />
            <span className="text-small text-ink-500 tabular-nums">
              {Math.min(index, list.length)}/{list.length}
            </span>
          </div>

          {done ? (
            <EmptyState
              icon="checkmark-circle"
              title="Set complete"
              description={`Charge calls: ${correctCount}/${list.length} correct.`}
              action={
                <Button onClick={restart}>
                  Run it again
                  <Icon name="reload" className="text-small" />
                </Button>
              }
            />
          ) : entry ? (
            <Reveal key={entry.id}>
              <Card>
                <CardBody className="space-y-5">
                  <p className="text-lead leading-7 text-ink-700">
                    {entry.sentence ? (
                      <Highlighted sentence={entry.sentence} word={entry.word} />
                    ) : (
                      <span className="accent-serif text-h2 text-ink-900">{entry.word}</span>
                    )}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <p className="mb-1.5 text-small font-medium text-ink-700">Charge in this sentence</p>
                      <ChargePicker value={charge} onChange={setCharge} disabled={revealed !== null} />
                    </div>
                    <Input
                      label="Your one-line meaning"
                      placeholder="What do you think it means here?"
                      value={guess}
                      onChange={(e) => setGuess(e.target.value)}
                      disabled={revealed !== null}
                    />
                  </div>

                  {error && (
                    <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
                      {error}
                    </p>
                  )}

                  {!revealed ? (
                    <div className="flex items-center gap-3">
                      <Button
                        disabled={charge === null || record.isPending}
                        onClick={() =>
                          record.mutate({
                            wordId: entry.id,
                            guessedCharge: charge!,
                            guessedMeaning: guess || undefined,
                          })
                        }
                      >
                        {record.isPending ? 'Checking…' : 'Reveal'}
                        <Icon name="chevron-down" className="text-small" />
                      </Button>
                      {charge === null && (
                        <span className="text-micro text-ink-400">Commit a charge first — that’s the drill.</span>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-control bg-paper p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="accent-serif text-h3 text-ink-900">{entry.word}</span>
                        {revealed.actualCharge && (
                          <Badge
                            tone={
                              revealed.actualCharge === 'positive'
                                ? 'green'
                                : revealed.actualCharge === 'negative'
                                  ? 'miss'
                                  : 'blue'
                            }
                          >
                            {CHARGE_LABEL[revealed.actualCharge]}
                          </Badge>
                        )}
                        <Badge tone={revealed.chargeCorrect ? 'green' : 'miss'}>
                          {revealed.chargeCorrect
                            ? 'Your charge: correct'
                            : `You said ${charge ? CHARGE_LABEL[charge].toLowerCase() : '—'}`}
                        </Badge>
                      </div>
                      {revealed.definition && <p className="text-body text-ink-700">{revealed.definition}</p>}
                      {revealed.root && (
                        <p className="text-small text-ink-500">
                          <span className="font-medium text-ink-700">Root: </span>
                          {revealed.root}
                        </p>
                      )}
                      {guess.trim() && (
                        <p className="text-small text-ink-500">
                          <span className="font-medium text-ink-700">You wrote: </span>“{guess.trim()}”
                        </p>
                      )}
                      <Button size="sm" onClick={next}>
                        {index === list.length - 1 ? 'Finish set' : 'Next word'}
                        <Icon name="arrow-right" className="text-small" />
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Reveal>
          ) : null}
        </div>
      )}

      <AddWordModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function AddWordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [word, setWord] = useState('');
  const [sentence, setSentence] = useState('');
  const [definition, setDefinition] = useState('');
  const [root, setRoot] = useState('');
  const [charge, setCharge] = useState<Charge | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(
    trpc.vocabularyManagement.createWord.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        setWord('');
        setSentence('');
        setDefinition('');
        setRoot('');
        setCharge(null);
        setError(null);
        onClose();
      },
      onError: (e) => setError(e.message),
    }),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a word"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={create.isPending}
            onClick={() => {
              setError(null);
              if (!charge) return setError('Pick the word’s charge.');
              create.mutate({ word, sentence, definition, root: root || undefined, charge });
            }}
          >
            {create.isPending ? 'Saving…' : 'Save word'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Word" placeholder="intransigent" value={word} onChange={(e) => setWord(e.target.value)} />
        <Textarea
          label="Sentence using it"
          placeholder="Negotiations collapsed after the delegation’s intransigent refusal to compromise."
          rows={3}
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
        />
        <Input
          label="Definition"
          placeholder="Refusing to compromise."
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
        <Input
          label="Root (optional)"
          placeholder="Latin in- (not) + transigere (to come to agreement)"
          value={root}
          onChange={(e) => setRoot(e.target.value)}
        />
        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Charge</p>
          <ChargePicker value={charge} onChange={setCharge} />
        </div>
        {error && (
          <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
