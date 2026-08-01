'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@/trpc/client';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/utils';
import { OptionButton, ScoreLine, ExerciseError } from './exercise-parts';

type TypeFilter = 'all' | 'prefix' | 'root' | 'suffix';

const TYPE_CHIPS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prefix', label: 'Prefixes' },
  { value: 'root', label: 'Roots' },
  { value: 'suffix', label: 'Suffixes' },
];

interface Item {
  morphemeId: string;
  kind: 'meaning' | 'piece';
  prompt: string;
  options: string[];
}

/**
 * Part 2 of learning the morphemes: a multiple-choice quiz. Shows a root, prefix,
 * or suffix and four possible meanings; pick the right one. Answers are graded
 * server-side and logged to morpheme_attempts, so the quiz feeds the same
 * by-family / by-exercise progress as everything else. Questions are prefetched
 * so "Next" is instant, and recent pieces won't repeat.
 */
export function MorphemeQuiz() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [current, setCurrent] = useState<Item | null>(null);
  const [buffer, setBuffer] = useState<Item | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string } | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const fetchOne = useCallback(
    () =>
      client.vocabulary.mcQuestion.query({
        kind: 'meaning',
        type: typeFilter === 'all' ? undefined : typeFilter,
      }) as Promise<Item>,
    [client, typeFilter],
  );

  const recent = useRef<string[]>([]);
  const fetchFresh = useCallback(async (): Promise<Item> => {
    let item = await fetchOne();
    for (let i = 0; i < 6 && recent.current.includes(item.morphemeId); i++) {
      item = await fetchOne();
    }
    recent.current.push(item.morphemeId);
    if (recent.current.length > 20) recent.current.shift();
    return item;
  }, [fetchOne]);

  const load = useCallback(async () => {
    setPhase('loading');
    setErrorMsg(null);
    setSelected(null);
    setResult(null);
    recent.current = [];
    try {
      const a = await fetchFresh();
      setCurrent(a);
      setPhase('ready');
      fetchFresh().then(setBuffer).catch(() => {});
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load a question.');
      setPhase('error');
    }
  }, [fetchFresh]);

  // Reload whenever the type filter changes (and on first mount).
  const startedFor = useRef<TypeFilter | null>(null);
  useEffect(() => {
    if (startedFor.current === typeFilter) return;
    startedFor.current = typeFilter;
    void load();
  }, [typeFilter, load]);

  const grade = useMutation(
    trpc.vocabulary.gradeMc.mutationOptions({
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
      setCurrent(buffer);
      setBuffer(null);
      fetchFresh().then(setBuffer).catch(() => {});
    } else {
      setPhase('loading');
      fetchFresh()
        .then((a) => {
          setCurrent(a);
          setPhase('ready');
          fetchFresh().then(setBuffer).catch(() => {});
        })
        .catch((e) => {
          setErrorMsg(e instanceof Error ? e.message : 'Could not load a question.');
          setPhase('error');
        });
    }
  };

  const chips = (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {TYPE_CHIPS.map((c) => (
        <button
          key={c.value}
          onClick={() => setTypeFilter(c.value)}
          aria-pressed={typeFilter === c.value}
          className={cn(
            'rounded-pill border px-3 py-1 text-small transition-colors',
            typeFilter === c.value ? 'border-blue bg-blue-tint text-ink-900' : 'border-line text-ink-600 hover:border-ink-400/40',
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  if (phase === 'loading' && !current) {
    return (
      <div className="space-y-5">
        {chips}
        <div className="h-64 animate-pulse rounded-card border border-line bg-sunken/50" />
      </div>
    );
  }
  if (phase === 'error' || !current) {
    return (
      <div className="space-y-5">
        {chips}
        <ExerciseError message={errorMsg ?? 'Could not load a question.'} onRetry={() => void load()} />
      </div>
    );
  }

  const q = current;
  const submit = () => {
    if (!selected) return;
    grade.mutate({ morphemeId: q.morphemeId, kind: q.kind, selected });
  };

  const optionState = (opt: string): 'idle' | 'correct' | 'wrong' => {
    if (!result) return 'idle';
    if (opt === result.correctAnswer) return 'correct';
    if (opt === selected) return 'wrong';
    return 'idle';
  };

  return (
    <div className="space-y-5">
      {chips}
      <Reveal key={q.morphemeId}>
        <Card>
          <CardBody className="space-y-5">
            <ScoreLine label="Pick the meaning" score={score} />

            <p className="text-h3 leading-relaxed text-ink-900">{q.prompt}</p>

            <div className="grid gap-2.5">
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
              <div className="flex items-center justify-between">
                <span className={cn('text-small font-medium', result.correct ? 'text-green' : 'text-miss')}>
                  {result.correct ? 'Correct' : `Answer: ${result.correctAnswer}`}
                </span>
                <Button onClick={next}>
                  Next
                  <Icon name="arrow-right" className="text-small" />
                </Button>
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
    </div>
  );
}
