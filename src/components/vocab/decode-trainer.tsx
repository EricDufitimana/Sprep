'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { ChargePicker } from '@/components/charge-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/utils';
import type { Charge } from '@/lib/types';
import { OptionButton } from './exercise-parts';
import { ReferenceDrawer } from './reference-drawer';
import { CHARGE_TONE, CHARGE_LABEL, groupLabel } from './labels';

type Mode = 'definition' | 'sentence' | 'cold';

const MODE_TABS: { value: Mode; label: string; blurb: string }[] = [
  { value: 'definition', label: 'Definition', blurb: 'See a definition, pick the word.' },
  { value: 'sentence', label: 'Sentence', blurb: 'See the word in a real sentence, pick the meaning.' },
  { value: 'cold', label: 'Cold decode', blurb: 'A word you haven’t seen — decode it from context.' },
];

interface SessionResult {
  correct: boolean;
  charge: Charge | null;
  chargeCorrect: boolean | null;
  usedHint: boolean;
  meaningGroup: string | null;
}

/** Bold the target word (and simple inflections) inside its sentence. */
function Highlighted({ sentence, word }: { sentence: string; word: string }) {
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx !== -1) {
    return (
      <>
        {sentence.slice(0, idx)}
        <mark className="rounded-sm bg-blue-tint px-1 font-semibold text-blue">{sentence.slice(idx, idx + word.length)}</mark>
        {sentence.slice(idx + word.length)}
      </>
    );
  }
  // Fall back to a stem match so inflected forms still highlight.
  const stem = word.slice(0, Math.max(4, word.length - 2));
  const sIdx = sentence.toLowerCase().indexOf(stem.toLowerCase());
  if (sIdx === -1) return <>{sentence}</>;
  const end = sentence.indexOf(' ', sIdx);
  const stop = end === -1 ? sentence.length : end;
  return (
    <>
      {sentence.slice(0, sIdx)}
      <mark className="rounded-sm bg-blue-tint px-1 font-semibold text-blue">{sentence.slice(sIdx, stop)}</mark>
      {sentence.slice(stop)}
    </>
  );
}

export function DecodeTrainer() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // ── Session config ──
  const [mode, setMode] = useState<Mode>('sentence');
  const [excludeLearned, setExcludeLearned] = useState(true);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [results, setResults] = useState<SessionResult[]>([]);

  // ── Per-item state ──
  const [chargeGuess, setChargeGuess] = useState<Charge | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [usedHint, setUsedHint] = useState(false);

  const syncWeak = useMutation(trpc.vocabularyTrainer.syncWeakWords.mutationOptions());

  const item = useQuery(
    trpc.vocabularyTrainer.nextItem.queryOptions({ mode, excludeLearned }, { enabled: started && !ended }),
  );

  const hint = useQuery(
    trpc.vocabularyTrainer.breakdown.queryOptions(
      { wordId: item.data?.wordId ?? '' },
      { enabled: hintOpen && !!item.data?.wordId },
    ),
  );

  const grade = useMutation(
    trpc.vocabularyTrainer.gradeItem.mutationOptions({
      onSuccess: (res) => {
        setResults((r) => [
          ...r,
          { correct: res.correct, charge: res.charge, chargeCorrect: res.chargeCorrect, usedHint, meaningGroup: res.meaningGroup },
        ]);
        void queryClient.invalidateQueries(trpc.vocabularyTrainer.stats.queryFilter());
        void queryClient.invalidateQueries(trpc.vocabulary.progress.queryFilter());
      },
    }),
  );
  const result = grade.data && !grade.isPending ? grade.data : null;

  const start = () => {
    setStarted(true);
    setEnded(false);
    setResults([]);
    grade.reset();
    // Pull in real misses from elsewhere in SPrep once per session.
    syncWeak.mutate();
  };

  const resetItem = () => {
    setChargeGuess(null);
    setSelected(null);
    setHintOpen(false);
    setUsedHint(false);
    grade.reset();
  };

  const next = () => {
    resetItem();
    void item.refetch();
  };

  const score = useMemo(() => ({
    correct: results.filter((r) => r.correct).length,
    total: results.length,
  }), [results]);

  // ── Config gate ──
  if (!started) {
    return (
      <Card>
        <CardBody className="space-y-5">
          <div>
            <h2 className="text-body font-semibold text-ink-900">Decode Trainer</h2>
            <p className="text-small text-ink-500">Infer meaning from context and roots — the way the SAT actually tests it.</p>
          </div>

          <div className="space-y-2">
            <p className="text-small font-medium text-ink-700">Mode</p>
            <div className="grid gap-2">
              {MODE_TABS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-control border px-4 py-2.5 text-left transition-colors',
                    mode === m.value ? 'border-blue bg-blue-tint' : 'border-line bg-surface hover:border-ink-400/40',
                  )}
                >
                  <span>
                    <span className="block text-body font-medium text-ink-900">{m.label}</span>
                    <span className="block text-small text-ink-500">{m.blurb}</span>
                  </span>
                  {mode === m.value && <Icon name="checkmark-circle" className="text-blue" />}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 text-small text-ink-700">
            <input
              type="checkbox"
              checked={excludeLearned}
              onChange={(e) => setExcludeLearned(e.target.checked)}
              className="h-4 w-4 rounded border-line text-blue focus:ring-blue"
            />
            Exclude words I&apos;ve learned (3 correct in a row)
          </label>

          <Button onClick={start}>
            Start session
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </CardBody>
      </Card>
    );
  }

  // ── End-of-session stats ──
  if (ended) {
    return <SessionStats results={results} onRestart={() => { setStarted(false); setEnded(false); }} />;
  }

  // ── Active item ──
  const q = item.data;
  const awaitingCharge = !!q?.chargeFirst && chargeGuess === null && !result;
  const optionsVisible = !awaitingCharge;

  return (
    <div className="space-y-4">
      {/* session bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-small text-ink-500">
          <Badge tone="neutral">{MODE_TABS.find((m) => m.value === mode)?.label}</Badge>
          {score.total > 0 && <span className="tabular-nums">{score.correct}/{score.total} correct</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEnded(true)} disabled={score.total === 0}>
          <Icon name="bar-chart" className="text-small" />
          End session
        </Button>
      </div>

      {item.isLoading || !q ? (
        <div className="h-72 animate-pulse rounded-card border border-line bg-sunken/50" />
      ) : item.isError ? (
        <Card>
          <CardBody className="space-y-3 text-center">
            <p role="alert" className="text-small text-miss">{item.error.message}</p>
            <Button variant="ghost" size="sm" onClick={() => item.refetch()}>
              <Icon name="reload" className="text-small" /> Retry
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Reveal key={q.wordId}>
          <Card>
            <CardBody className="space-y-5">
              {/* Prompt */}
              {q.mode === 'definition' ? (
                <div>
                  <p className="text-small text-ink-500">Which word means…</p>
                  <p className="mt-1 text-lead leading-7 text-ink-900">{q.promptDefinition}</p>
                </div>
              ) : (
                <div>
                  <p className="text-small text-ink-500">Read the sentence — decode the highlighted word.</p>
                  <p className="mt-1 text-lead leading-7 text-ink-700">
                    <Highlighted sentence={q.sentence ?? ''} word={q.word} />
                  </p>
                  {q.partOfSpeech && <p className="mt-1 text-small italic text-ink-400">{q.word} · {q.partOfSpeech}</p>}
                </div>
              )}

              {/* Charge-first commit step (charged words only) */}
              {q.chargeFirst && (
                <div className="rounded-control border border-line bg-sunken/40 p-3">
                  <p className="mb-2 text-small font-medium text-ink-700">
                    First: is this word positive, negative, or neutral here?
                  </p>
                  <ChargePicker
                    value={chargeGuess}
                    onChange={(c) => setChargeGuess(c)}
                    disabled={result !== null}
                  />
                  {awaitingCharge && <p className="mt-2 text-micro text-ink-400">Commit a charge to reveal the options.</p>}
                </div>
              )}

              {/* Break-it-down hint */}
              {optionsVisible && !result && (
                <div>
                  <button
                    type="button"
                    onClick={() => { setHintOpen((o) => !o); setUsedHint(true); }}
                    className="inline-flex items-center gap-1.5 text-small font-medium text-blue hover:underline"
                  >
                    <Icon name="question-circle" className="text-small" />
                    {hintOpen ? 'Hide breakdown' : 'Break it down'}
                  </button>
                  {hintOpen && (
                    <div className="mt-2 rounded-control border border-dashed border-line bg-surface p-3">
                      {hint.isLoading ? (
                        <div className="h-8 animate-pulse rounded bg-sunken/50" />
                      ) : hint.data && hint.data.pieces.length > 0 ? (
                        <ul className="space-y-1">
                          {hint.data.pieces.map((p) => (
                            <li key={p.text} className="flex items-baseline gap-2 text-small">
                              <span className="accent-serif font-semibold text-ink-900">{p.text}</span>
                              <span className="text-ink-600">{p.meaning}</span>
                              <Badge tone="neutral">{p.type}</Badge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-small text-ink-500">No known root or prefix in this one — lean on the sentence and its charge.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Options */}
              {optionsVisible && (
                <div className="grid gap-2">
                  {q.options.map((opt) => {
                    const isSelected = selected === opt;
                    const isCorrect = result?.correctAnswer === opt;
                    const isWrongPick = result != null && isSelected && !result.correct;
                    return (
                      <OptionButton
                        key={opt}
                        label={opt}
                        selected={isSelected}
                        state={result ? (isCorrect ? 'correct' : isWrongPick ? 'wrong' : 'idle') : 'idle'}
                        disabled={result !== null}
                        onClick={() => setSelected(opt)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Reveal / actions */}
              {result ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Icon
                      name={result.correct ? 'checkmark-circle' : 'cross-circle'}
                      className={result.correct ? 'text-green' : 'text-miss'}
                    />
                    <span className={cn('text-small font-medium', result.correct ? 'text-green' : 'text-miss')}>
                      {result.correct ? 'Correct' : 'Not quite'}
                    </span>
                    {result.charge && (
                      <Badge tone={CHARGE_TONE[result.charge]}>
                        {CHARGE_LABEL[result.charge]}
                        {result.chargeCorrect === false && ' — you guessed otherwise'}
                      </Badge>
                    )}
                  </div>
                  <div className="rounded-control bg-sunken/40 p-3">
                    <p className="text-small font-medium text-ink-500">{q.word}</p>
                    <p className="text-body text-ink-900">{result.definition}</p>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={next}>
                      Next word
                      <Icon name="arrow-right" className="text-small" />
                    </Button>
                  </div>
                </div>
              ) : (
                optionsVisible && (
                  <Button disabled={selected === null || grade.isPending} onClick={() => grade.mutate({
                    wordId: q.wordId,
                    mode: q.mode,
                    selected: selected!,
                    usedHint,
                    chargeGuess: q.chargeFirst ? chargeGuess : null,
                  })}>
                    Check
                  </Button>
                )
              )}
            </CardBody>
          </Card>
        </Reveal>
      )}

      <ReferenceDrawer highlightGroup={result?.meaningGroup ?? null} />
    </div>
  );
}

/** End-of-session breakdown: score, charge, decode-vs-guess, weakest family. */
function SessionStats({ results, onRestart }: { results: SessionResult[]; onRestart: () => void }) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const pct = total === 0 ? 0 : Math.round((correct / total) * 100);

  const chargeBuckets = new Map<string, { n: number; ok: number }>();
  const familyBuckets = new Map<string, { n: number; ok: number }>();
  const hint = { n: 0, ok: 0 };
  const noHint = { n: 0, ok: 0 };

  for (const r of results) {
    if (r.charge) {
      const b = chargeBuckets.get(r.charge) ?? { n: 0, ok: 0 };
      b.n += 1; if (r.correct) b.ok += 1; chargeBuckets.set(r.charge, b);
    }
    if (r.meaningGroup) {
      const b = familyBuckets.get(r.meaningGroup) ?? { n: 0, ok: 0 };
      b.n += 1; if (r.correct) b.ok += 1; familyBuckets.set(r.meaningGroup, b);
    }
    if (r.usedHint) { hint.n += 1; if (r.correct) hint.ok += 1; }
    else { noHint.n += 1; if (r.correct) noHint.ok += 1; }
  }

  const worstCharge = Array.from(chargeBuckets.entries())
    .map(([k, b]) => ({ k, acc: b.n ? b.ok / b.n : 1, n: b.n }))
    .sort((a, b) => a.acc - b.acc)[0];
  const worstFamily = Array.from(familyBuckets.entries())
    .map(([k, b]) => ({ k, acc: b.n ? b.ok / b.n : 1, n: b.n }))
    .sort((a, b) => a.acc - b.acc)[0];

  const rate = (b: { n: number; ok: number }) => (b.n === 0 ? null : Math.round((b.ok / b.n) * 100));

  return (
    <Card>
      <CardBody className="space-y-6">
        <div className="text-center">
          <p className="text-small uppercase tracking-wide text-ink-400">Session complete</p>
          <p className="mt-1 text-h1 font-semibold tabular-nums text-ink-900">{pct}%</p>
          <p className="text-small text-ink-500">{correct} of {total} correct</p>
        </div>

        {chargeBuckets.size > 0 && (
          <div>
            <p className="mb-2 text-small font-medium text-ink-700">By charge</p>
            <div className="space-y-1.5">
              {Array.from(chargeBuckets.entries()).map(([k, b]) => (
                <div key={k} className="flex items-center justify-between text-small">
                  <Badge tone={CHARGE_TONE[k]}>{CHARGE_LABEL[k]}</Badge>
                  <span className="tabular-nums text-ink-600">{rate(b)}% <span className="text-ink-400">({b.ok}/{b.n})</span></span>
                </div>
              ))}
            </div>
            {worstCharge && worstCharge.n > 0 && (
              <p className="mt-2 text-small text-ink-500">Weakest charge: <span className="font-medium text-ink-700">{CHARGE_LABEL[worstCharge.k]}</span>.</p>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 text-small font-medium text-ink-700">Decode vs. guess</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-control bg-sunken/40 p-3 text-center">
              <p className="text-micro uppercase tracking-wide text-ink-400">With hint</p>
              <p className="text-h3 font-semibold tabular-nums text-ink-900">{rate(hint) ?? '—'}{rate(hint) !== null && '%'}</p>
              <p className="text-micro text-ink-400">{hint.n} answers</p>
            </div>
            <div className="rounded-control bg-sunken/40 p-3 text-center">
              <p className="text-micro uppercase tracking-wide text-ink-400">No hint</p>
              <p className="text-h3 font-semibold tabular-nums text-ink-900">{rate(noHint) ?? '—'}{rate(noHint) !== null && '%'}</p>
              <p className="text-micro text-ink-400">{noHint.n} answers</p>
            </div>
          </div>
          <p className="mt-2 text-small text-ink-500">
            Hint used on {total === 0 ? 0 : Math.round((hint.n / total) * 100)}% of words.
          </p>
        </div>

        {worstFamily && worstFamily.n > 0 && (
          <div className="rounded-control border border-amber/30 bg-amber-tint/40 p-3">
            <p className="text-small font-medium text-ink-900">Weakest root-family: {groupLabel(worstFamily.k)}</p>
            <p className="text-small text-ink-600">
              Missed words here share this family — open the reference drawer and review it.
            </p>
          </div>
        )}

        <Button onClick={onRestart}>
          New session
          <Icon name="reload" className="text-small" />
        </Button>
      </CardBody>
    </Card>
  );
}
