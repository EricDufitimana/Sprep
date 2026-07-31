'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@/trpc/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/utils';
import { BLANK_TOKEN } from '@/lib/vocab/sat-distractors';
import { OptionButton, ScoreLine, ExerciseError } from './exercise-parts';

/** The four SAT traps, named for the reveal. Order is display priority. */
const TRAP_META: Record<string, { label: string; tone: BadgeTone }> = {
  answer: { label: 'Correct', tone: 'green' },
  reversal: { label: 'Reversal trap', tone: 'coral' },
  same_tone: { label: 'Tone trap', tone: 'amber' },
  associate: { label: 'Association trap', tone: 'blue' },
  hard_word: { label: 'Hard-word trap', tone: 'neutral' },
  filler: { label: 'Distractor', tone: 'neutral' },
};

const DIFFICULTY_META: Record<string, { label: string; tone: BadgeTone }> = {
  gentle: { label: 'Gentle', tone: 'neutral' },
  tricky: { label: 'Tricky', tone: 'amber' },
  brutal: { label: 'Brutal', tone: 'miss' },
};

interface GradeResult {
  correct: boolean;
  correctWord: string;
  definition: string;
  charge: 'positive' | 'negative' | 'neutral' | null;
  options: { word: string; role: string; why: string; isAnswer: boolean }[];
}

interface Item {
  wordId: string;
  blankedSentence: string;
  partOfSpeech: string | null;
  options: string[];
  difficulty: string;
}

/**
 * (d) Sentence completion — the SAT "words in context" drill. A real sentence
 * with the word blanked and four options, three of which are engineered traps.
 * The reveal names each trap so the practice teaches the trick, not just the word.
 */
export function SentenceCompletionExercise() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  // The question is fetched imperatively (not via useQuery) so that returning to
  // the page never refetches and swaps out an in-progress question, and so the
  // NEXT question can be prefetched into a buffer for an instant advance.
  const [current, setCurrent] = useState<Item | null>(null);
  const [buffer, setBuffer] = useState<Item | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const fetchOne = useCallback(
    () => client.vocabulary.sentenceCompletion.query() as Promise<Item>,
    [client],
  );

  // Avoid short-term repeats: remember the last 25 words shown and re-roll a
  // freshly fetched item if it's one of them. This also guarantees the prefetched
  // buffer is a different word from the one currently on screen.
  const recent = useRef<string[]>([]);
  const fetchFresh = useCallback(async (): Promise<Item> => {
    let item = await fetchOne();
    for (let i = 0; i < 6 && recent.current.includes(item.wordId); i++) {
      item = await fetchOne();
    }
    recent.current.push(item.wordId);
    if (recent.current.length > 25) recent.current.shift();
    return item;
  }, [fetchOne]);

  const load = useCallback(async () => {
    setPhase('loading');
    setErrorMsg(null);
    recent.current = [];
    try {
      const a = await fetchFresh();
      setCurrent(a);
      setPhase('ready');
      // Prefetch the next question in the background for an instant advance.
      fetchFresh().then(setBuffer).catch(() => {});
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load a sentence.');
      setPhase('error');
    }
  }, [fetchFresh]);

  // Initial load, guarded against Strict Mode's double-invoke.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const grade = useMutation(
    trpc.vocabulary.gradeSentenceCompletion.mutationOptions({
      onSuccess: (res) => {
        setResult(res);
        setScore((s) => ({ correct: s.correct + (res.correct ? 1 : 0), total: s.total + 1 }));
        void queryClient.invalidateQueries(trpc.vocabulary.progress.queryFilter());
      },
    }),
  );

  const next = () => {
    setSelected(null);
    setResult(null);
    grade.reset();
    if (buffer) {
      // Instant: show the prefetched question, then refill the buffer in the background.
      setCurrent(buffer);
      setBuffer(null);
      fetchFresh().then(setBuffer).catch(() => {});
    } else {
      // Buffer not ready yet — fetch one, keeping the loader brief.
      setPhase('loading');
      fetchFresh()
        .then((a) => {
          setCurrent(a);
          setPhase('ready');
          fetchFresh().then(setBuffer).catch(() => {});
        })
        .catch((e) => {
          setErrorMsg(e instanceof Error ? e.message : 'Could not load a sentence.');
          setPhase('error');
        });
    }
  };

  if (phase === 'loading' && !current) {
    return <div className="h-72 animate-pulse rounded-card border border-line bg-sunken/50" />;
  }
  if (phase === 'error' || !current) {
    return <ExerciseError message={errorMsg ?? 'Could not load a sentence.'} onRetry={() => void load()} />;
  }

  const q = current;
  const [before, after] = q.blankedSentence.split(BLANK_TOKEN);
  const diff = DIFFICULTY_META[q.difficulty] ?? DIFFICULTY_META.gentle;

  const submit = () => {
    if (!selected) return;
    grade.mutate({ wordId: q.wordId, options: q.options, selected });
  };

  const optionState = (word: string): 'idle' | 'correct' | 'wrong' => {
    if (!result) return 'idle';
    if (word.toLowerCase() === result.correctWord.toLowerCase()) return 'correct';
    if (word === selected) return 'wrong';
    return 'idle';
  };

  return (
    <Reveal key={q.wordId}>
      <Card>
        <CardBody className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <ScoreLine label="Fill the blank" score={score} />
            <span className="flex items-center gap-1.5 text-micro uppercase tracking-wide text-ink-400">
              SAT-style
              <Badge tone={diff.tone}>{diff.label}</Badge>
            </span>
          </div>

          {/* The sentence with a styled blank (filled with the answer after grading). */}
          <p className="text-h3 leading-relaxed text-ink-900">
            {before}
            {result ? (
              <span className="font-semibold text-green underline decoration-green/40 underline-offset-4">
                {result.correctWord}
              </span>
            ) : (
              <span className="mx-0.5 inline-block w-24 border-b-2 border-ink-400/60 align-baseline" aria-label="blank" />
            )}
            {after}
          </p>

          {!result && q.partOfSpeech && (
            <p className="text-small text-ink-500">
              Pick the word that fits the blank — every option is a{' '}
              <span className="italic">{q.partOfSpeech}</span>, so grammar won&apos;t give it away.
            </p>
          )}

          <div className="grid gap-2.5 sm:grid-cols-2">
            {q.options.map((opt) => (
              <OptionButton
                key={opt}
                label={opt}
                selected={selected === opt}
                state={optionState(opt)}
                disabled={result !== null || grade.isPending}
                onClick={() => setSelected(opt)}
              />
            ))}
          </div>

          {grade.isError && !result && (
            <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
              {grade.error.message}
            </p>
          )}

          {result ? (
            <div className="space-y-4">
              <div className="rounded-card border border-line bg-sunken/40 p-4">
                <p className="text-small text-ink-500">
                  <span className="font-medium text-ink-900">{result.correctWord}</span> — {result.definition}
                </p>
              </div>

              {/* The teaching payoff: name the trap behind every wrong option. */}
              <div className="space-y-2">
                <p className="text-micro uppercase tracking-wide text-ink-400">Why the other options were there</p>
                {result.options
                  .filter((o) => !o.isAnswer)
                  .map((o) => {
                    const meta = TRAP_META[o.role] ?? TRAP_META.filler;
                    return (
                      <div key={o.word} className="flex gap-3 rounded-control bg-surface px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-small font-medium text-ink-800">{o.word}</span>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                          </div>
                          <p className="mt-0.5 text-small text-ink-500">{o.why}</p>
                        </div>
                      </div>
                    );
                  })}
              </div>

              <div className="flex items-center justify-between">
                <span className={cn('text-small font-medium', result.correct ? 'text-green' : 'text-miss')}>
                  {result.correct ? 'Correct' : `You picked ${selected}`}
                </span>
                <Button onClick={next}>
                  Next sentence
                  <Icon name="arrow-right" className="text-small" />
                </Button>
              </div>
            </div>
          ) : (
            <Button disabled={!selected || grade.isPending} onClick={submit}>
              {grade.isPending ? (
                <>
                  <Icon name="spinner-solid" className="animate-spin text-small" />
                  Checking…
                </>
              ) : (
                'Submit answer'
              )}
            </Button>
          )}
        </CardBody>
      </Card>
    </Reveal>
  );
}
