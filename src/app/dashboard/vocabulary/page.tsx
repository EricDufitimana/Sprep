'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { MorphemeCard } from '@/components/vocab/morpheme-card';
import { DecodeTrainer } from '@/components/vocab/decode-trainer';
import { FreeResponseExercise } from '@/components/vocab/free-response-exercise';
import {
  GROUP_ORDER,
  EXERCISE_LABEL,
  CHARGE_LABEL,
  CHARGE_TONE,
  groupLabel,
  accuracyTone,
} from '@/components/vocab/labels';

type TopTab = 'learn' | 'practice' | 'progress';
type PracticeTab = 'trainer' | 'free';

const TOP_TABS = [
  { value: 'learn', label: 'Learn' },
  { value: 'practice', label: 'Practice' },
  { value: 'progress', label: 'Progress' },
] as const;

const PRACTICE_TABS = [
  { value: 'trainer', label: 'Decode Trainer' },
  { value: 'free', label: 'Free response' },
] as const;

const TYPE_RANK: Record<string, number> = { prefix: 0, root: 1, suffix: 2 };

export default function VocabularyPage() {
  const trpc = useTRPC();
  const [tab, setTab] = useState<TopTab>('practice');
  const [practice, setPractice] = useState<PracticeTab>('trainer');

  const morphemes = useQuery(trpc.vocabulary.listMorphemes.queryOptions());
  const progress = useQuery(trpc.vocabulary.progress.queryOptions());
  const trainerStats = useQuery(trpc.vocabularyTrainer.stats.queryOptions());

  const groups = [...(morphemes.data ?? [])].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.group);
    const bi = GROUP_ORDER.indexOf(b.group);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <>
      <PageHeader
        title="Vocabulary"
        description="Learn the roots, then decode words in context — every attempt is graded and fed back as spaced practice."
      >
        <Tabs items={TOP_TABS} value={tab} onChange={setTab} />
      </PageHeader>

      {/* ── Learn ─────────────────────────────────────────────────────────── */}
      {tab === 'learn' && (
        <>
          {morphemes.isLoading ? (
            <div className="h-96 animate-pulse rounded-card border border-line bg-sunken/50" />
          ) : groups.length === 0 ? (
            <EmptyState
              icon="book"
              title="No morphemes yet"
              description="Run the vocabulary seed to load the roots, prefixes, and suffixes."
              action={<span className="text-small text-ink-400">npm run seed:vocab</span>}
            />
          ) : (
            <div className="space-y-10">
              {groups.map((g) => (
                <section key={g.group}>
                  <h2 className="mb-3 text-h3 font-semibold text-ink-900">{groupLabel(g.group)}</h2>
                  <Reveal stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[...g.morphemes]
                      .sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9))
                      .map((m) => (
                        <MorphemeCard key={m.id} morpheme={m} />
                      ))}
                  </Reveal>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Practice ──────────────────────────────────────────────────────── */}
      {tab === 'practice' && (
        <div className="mx-auto max-w-2xl space-y-5">
          <div className="flex justify-center">
            <Tabs items={PRACTICE_TABS} value={practice} onChange={setPractice} />
          </div>
          {practice === 'trainer' ? <DecodeTrainer /> : <FreeResponseExercise />}
        </div>
      )}

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      {tab === 'progress' && (
        <div className="mx-auto max-w-2xl space-y-8">
          <TrainerStatsPanel stats={trainerStats.data} loading={trainerStats.isLoading} />

          {progress.data && (progress.data.byGroup.length > 0 || progress.data.byExercise.length > 0) && (
            <>
              <ProgressSection
                title="By meaning-family"
                subtitle="Which root and prefix families you're weakest on."
                rows={progress.data.byGroup.map((r) => ({ ...r, label: groupLabel(r.key) }))}
              />
              <ProgressSection
                title="By exercise type"
                subtitle="Roots practice and free-response grading."
                rows={progress.data.byExercise.map((r) => ({ ...r, label: EXERCISE_LABEL[r.key] ?? r.key }))}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}

interface ProgressRow {
  key: string;
  label: string;
  attempts: number;
  correct: number;
  accuracyPercent: number;
}

function ProgressSection({ title, subtitle, rows }: { title: string; subtitle: string; rows: ProgressRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="text-body font-semibold text-ink-900">{title}</h2>
          <p className="text-small text-ink-500">{subtitle}</p>
        </div>
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-small font-medium text-ink-700">{r.label}</span>
                <span className="text-small tabular-nums text-ink-500">
                  {r.accuracyPercent}% <span className="text-ink-400">({r.correct}/{r.attempts})</span>
                </span>
              </div>
              <ProgressBar value={r.accuracyPercent} tone={accuracyTone(r.accuracyPercent)} label={r.label} />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

type TrainerStats = {
  byCharge: { key: string; attempts: number; accuracyPercent: number }[];
  chargeReadAccuracy: number | null;
  decodeVsGuess: {
    withHint: { attempts: number; accuracyPercent: number };
    withoutHint: { attempts: number; accuracyPercent: number };
  };
  weakestRootFamily: { key: string; attempts: number; accuracyPercent: number } | null;
  rootFamilies: { key: string; attempts: number; accuracyPercent: number }[];
};

function TrainerStatsPanel({ stats, loading }: { stats?: TrainerStats; loading: boolean }) {
  if (loading) return <div className="h-56 animate-pulse rounded-card border border-line bg-sunken/50" />;

  const hasData =
    stats && (stats.byCharge.length > 0 || stats.rootFamilies.length > 0 ||
      stats.decodeVsGuess.withHint.attempts > 0 || stats.decodeVsGuess.withoutHint.attempts > 0);

  if (!hasData) {
    return (
      <EmptyState
        icon="bar-chart"
        title="No decode practice yet"
        description="Run a Decode Trainer session and your accuracy by charge, decode-vs-guess, and weakest root-family show up here."
        action={<span className="text-small text-ink-400">Head to the Practice tab</span>}
      />
    );
  }

  const { decodeVsGuess } = stats;
  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-body font-semibold text-ink-900">Decode Trainer</h2>
          <p className="text-small text-ink-500">Where the grading says you stand — so you know what to study.</p>
        </div>

        {stats.byCharge.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-small font-medium text-ink-700">By charge</p>
            {stats.byCharge.map((c) => (
              <div key={c.key} className="flex items-center justify-between text-small">
                <Badge tone={CHARGE_TONE[c.key]}>{CHARGE_LABEL[c.key] ?? c.key}</Badge>
                <span className="tabular-nums text-ink-500">{c.accuracyPercent}% <span className="text-ink-400">({c.attempts})</span></span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-control bg-sunken/40 p-3 text-center">
            <p className="text-micro uppercase tracking-wide text-ink-400">With hint</p>
            <p className="text-h3 font-semibold tabular-nums text-ink-900">
              {decodeVsGuess.withHint.attempts ? `${decodeVsGuess.withHint.accuracyPercent}%` : '—'}
            </p>
            <p className="text-micro text-ink-400">{decodeVsGuess.withHint.attempts} answers</p>
          </div>
          <div className="rounded-control bg-sunken/40 p-3 text-center">
            <p className="text-micro uppercase tracking-wide text-ink-400">No hint</p>
            <p className="text-h3 font-semibold tabular-nums text-ink-900">
              {decodeVsGuess.withoutHint.attempts ? `${decodeVsGuess.withoutHint.accuracyPercent}%` : '—'}
            </p>
            <p className="text-micro text-ink-400">{decodeVsGuess.withoutHint.attempts} answers</p>
          </div>
        </div>

        {stats.chargeReadAccuracy !== null && (
          <p className="text-small text-ink-500">
            You read a word&apos;s charge right <span className="font-medium text-ink-700">{stats.chargeReadAccuracy}%</span> of the time.
          </p>
        )}

        {stats.weakestRootFamily && (
          <div className="rounded-control border border-amber/30 bg-amber-tint/40 p-3">
            <p className="text-small font-medium text-ink-900">Weakest root-family: {groupLabel(stats.weakestRootFamily.key)}</p>
            <p className="text-small text-ink-600">
              {stats.weakestRootFamily.accuracyPercent}% across {stats.weakestRootFamily.attempts} answers — review it in Learn.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
