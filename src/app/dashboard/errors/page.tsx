'use client';

import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import type { questionDomainSchema } from '@/lib/validation';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { RichText } from '@/components/rich-text';
import { MathHtml } from '@/components/math-html';
import { QuestionFigure } from '@/components/question-figure';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';
import { domainLabel } from '@/lib/labels';
import { formatRelative } from '@/lib/labels';
import { useSection, SECTION_LABELS, type Section } from '@/lib/section';

/* ── Types (inferred from the router so the page stays in sync) ───────────── */
function useErrorLog(input: LogInput, ready: boolean) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.errors.log.queryOptions(input), enabled: ready });
}
type LogData = NonNullable<ReturnType<typeof useErrorLog>['data']>;
type LogItem = LogData['items'][number];
type Opt = { letter: string; text: string };

type Difficulty = 'easy' | 'medium' | 'hard';
type Status = 'all' | 'unmastered' | 'mastered';
type Sort = 'recent' | 'most_missed' | 'difficulty';
type QDomain = z.infer<typeof questionDomainSchema>;

interface LogInput {
  section: Section;
  domain?: QDomain;
  skill?: string;
  difficulty?: Difficulty[];
  status: Status;
  flaggedOnly: boolean;
  search?: string;
  sort: Sort;
}

const DIFF_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const DIFF_TONE: Record<string, string> = {
  easy: 'bg-green-tint text-green',
  medium: 'bg-amber-tint text-amber',
  hard: 'bg-miss-tint text-miss',
};
const SORTS: { value: Sort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'most_missed', label: 'Most missed' },
  { value: 'difficulty', label: 'Hardest first' },
];

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function ErrorLogPage() {
  const { section, ready } = useSection();

  // Filter state. Section is global (sidebar profile), the rest are local.
  const [domain, setDomain] = useState<QDomain | undefined>();
  const [skill, setSkill] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<Set<Difficulty>>(new Set());
  const [status, setStatus] = useState<Status>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('recent');
  const [search, setSearch] = useState('');

  // Debounce the search so the server isn't re-scanned on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const input: LogInput = {
    section,
    domain,
    skill,
    difficulty: difficulty.size ? Array.from(difficulty) : undefined,
    status,
    flaggedOnly,
    search: debouncedSearch || undefined,
    sort,
  };

  const q = useErrorLog(input, ready);
  const headerDescription = `${SECTION_LABELS[section]} — every question you've missed, grouped so you can drill into weak spots and grind them to mastery.`;

  const anyFilter =
    domain !== undefined ||
    skill !== undefined ||
    difficulty.size > 0 ||
    status !== 'all' ||
    flaggedOnly ||
    search.trim() !== '';
  const clearFilters = () => {
    setDomain(undefined);
    setSkill(undefined);
    setDifficulty(new Set());
    setStatus('all');
    setFlaggedOnly(false);
    setSearch('');
  };

  // Reset the skill filter whenever the chosen domain changes.
  const selectDomain = (d: string | undefined) => {
    setDomain(d as QDomain | undefined);
    setSkill(undefined);
  };

  if (!ready || q.isLoading) {
    return (
      <>
        <PageHeader title="Error Log" description={headerDescription} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-card bg-sunken/60" />
          ))}
        </div>
        <div className="mt-6 h-64 animate-pulse rounded-card bg-sunken/40" />
      </>
    );
  }

  const data = q.data;
  const noneEver = !data || data.stats.totalFailed === 0;

  if (noneEver) {
    return (
      <>
        <PageHeader title="Error Log" description={headerDescription} />
        <EmptyState
          icon="checkmark-circle"
          title="No mistakes logged — yet"
          description="As you answer questions in tests and the Question Bank, anything you miss lands here so you can review and master it. Nothing wrong so far in this section."
          action={null}
        />
      </>
    );
  }

  const stats = data.stats;

  return (
    <>
      <PageHeader title="Error Log" description={headerDescription} />

      {/* Stat tiles */}
      <Reveal stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon="cross-circle"
          tone="miss"
          label="Missed questions"
          value={stats.totalFailed}
          hint="unique questions you've gotten wrong"
        />
        <StatTile
          icon="target"
          tone="amber"
          label="Still to master"
          value={stats.unmastered}
          hint="last attempt was still wrong"
          active={status === 'unmastered'}
          onClick={() => setStatus(status === 'unmastered' ? 'all' : 'unmastered')}
        />
        <StatTile
          icon="checkmark-circle"
          tone="green"
          label="Mastered"
          value={stats.mastered}
          hint="since answered correctly"
          active={status === 'mastered'}
          onClick={() => setStatus(status === 'mastered' ? 'all' : 'mastered')}
        />
        <StatTile
          icon="flag"
          tone="blue"
          label="Flagged"
          value={stats.flagged}
          hint="marked for another look"
          active={flaggedOnly}
          onClick={() => setFlaggedOnly((v) => !v)}
        />
      </Reveal>

      <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_1fr]">
        {/* Filter rail */}
        <FilterRail
          stats={stats}
          domain={domain}
          skill={skill}
          difficulty={difficulty}
          status={status}
          flaggedOnly={flaggedOnly}
          onDomain={selectDomain}
          onSkill={setSkill}
          onDifficulty={setDifficulty}
          onStatus={setStatus}
          onFlaggedOnly={setFlaggedOnly}
          anyFilter={anyFilter}
          onClear={clearFilters}
        />

        {/* Results */}
        <div className="min-w-0">
          {/* Toolbar: search + sort + count */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your missed questions…"
              className="min-w-[12rem] flex-1"
            />
            <label className="flex items-center gap-2 text-small text-ink-600">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-control border border-line bg-surface px-2.5 py-2 text-small text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="mb-3 text-small text-ink-500">
            {q.isFetching ? (
              <span className="inline-flex items-center gap-2">
                <LoadingDots /> Updating…
              </span>
            ) : (
              <>
                Showing <span className="font-semibold text-ink-800">{data.shown}</span>{' '}
                {data.shown === 1 ? 'question' : 'questions'}
                {anyFilter ? ' matching your filters' : ''}.
              </>
            )}
          </p>

          {data.items.length === 0 ? (
            <EmptyState
              icon="target"
              title="No matches"
              description="No missed questions match these filters. Try clearing one, or widen the difficulty."
              action={
                anyFilter ? (
                  <Button variant="ghost" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Reveal stagger className="flex flex-col gap-3">
              {data.items.map((item) => (
                <ErrorCard key={item.questionId} item={item} section={section} />
              ))}
            </Reveal>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Stat tile ────────────────────────────────────────────────────────────── */
function StatTile({
  icon,
  tone,
  label,
  value,
  hint,
  active,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  tone: 'miss' | 'amber' | 'green' | 'blue';
  label: string;
  value: number;
  hint: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const toneRing: Record<string, string> = {
    miss: 'text-miss',
    amber: 'text-amber',
    green: 'text-green',
    blue: 'text-blue',
  };
  const toneBg: Record<string, string> = {
    miss: 'bg-miss-tint',
    amber: 'bg-amber-tint',
    green: 'bg-green-tint',
    blue: 'bg-blue-tint',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-card border bg-surface px-4 py-3 text-left transition-colors',
        onClick && 'hover:border-ink-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
        active ? 'border-blue ring-1 ring-blue/30' : 'border-line',
      )}
    >
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', toneBg[tone])}>
        <Icon name={icon} className={cn('text-lead', toneRing[tone])} />
      </span>
      <span className="min-w-0">
        <span className="block text-h2 font-semibold leading-none text-ink-900">{value}</span>
        <span className="mt-1 block text-small font-medium text-ink-700">{label}</span>
        <span className="block truncate text-micro text-ink-400">{hint}</span>
      </span>
    </Comp>
  );
}

/* ── Filter rail ──────────────────────────────────────────────────────────── */
function FilterRail({
  stats,
  domain,
  skill,
  difficulty,
  status,
  flaggedOnly,
  onDomain,
  onSkill,
  onDifficulty,
  onStatus,
  onFlaggedOnly,
  anyFilter,
  onClear,
}: {
  stats: LogData['stats'];
  domain: string | undefined;
  skill: string | undefined;
  difficulty: Set<Difficulty>;
  status: Status;
  flaggedOnly: boolean;
  onDomain: (d: string | undefined) => void;
  onSkill: (s: string | undefined) => void;
  onDifficulty: (s: Set<Difficulty>) => void;
  onStatus: (s: Status) => void;
  onFlaggedOnly: (v: boolean) => void;
  anyFilter: boolean;
  onClear: () => void;
}) {
  const skillsForDomain = useMemo(
    () => (domain ? stats.bySkill.filter((s) => s.domain === domain) : []),
    [domain, stats.bySkill],
  );

  const toggleDifficulty = (d: Difficulty) => {
    const next = new Set(difficulty);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onDifficulty(next);
  };

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-small font-semibold uppercase tracking-wide text-ink-500">Filters</h2>
            {anyFilter && (
              <button
                type="button"
                onClick={onClear}
                className="text-micro font-medium text-blue hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Status */}
          <FilterGroup label="Status">
            <div className="flex flex-col gap-1">
              {([
                { value: 'all', label: 'All missed', count: stats.totalFailed },
                { value: 'unmastered', label: 'Still to master', count: stats.unmastered },
                { value: 'mastered', label: 'Mastered', count: stats.mastered },
              ] as const).map((s) => (
                <RailRow
                  key={s.value}
                  label={s.label}
                  count={s.count}
                  active={status === s.value}
                  onClick={() => onStatus(s.value)}
                />
              ))}
            </div>
          </FilterGroup>

          {/* Domain */}
          <FilterGroup label="Domain">
            <div className="flex flex-col gap-1">
              <RailRow
                label="All domains"
                count={stats.totalFailed}
                active={domain === undefined}
                onClick={() => onDomain(undefined)}
              />
              {stats.byDomain.map((d) => (
                <RailRow
                  key={d.domain}
                  label={domainLabel(d.domain)}
                  count={d.total}
                  sub={d.unmastered > 0 ? `${d.unmastered} to master` : 'all mastered'}
                  active={domain === d.domain}
                  onClick={() => onDomain(domain === d.domain ? undefined : d.domain)}
                />
              ))}
            </div>
          </FilterGroup>

          {/* Skill (subdomain) — only within a chosen domain */}
          {domain && skillsForDomain.length > 0 && (
            <FilterGroup label="Skill">
              <div className="flex flex-col gap-1">
                <RailRow
                  label="All skills"
                  count={stats.byDomain.find((d) => d.domain === domain)?.total ?? 0}
                  active={skill === undefined}
                  onClick={() => onSkill(undefined)}
                />
                {skillsForDomain.map((s) => (
                  <RailRow
                    key={s.skill}
                    label={s.skill}
                    count={s.total}
                    sub={s.unmastered > 0 ? `${s.unmastered} to master` : 'all mastered'}
                    active={skill === s.skill}
                    onClick={() => onSkill(skill === s.skill ? undefined : s.skill)}
                  />
                ))}
              </div>
            </FilterGroup>
          )}

          {/* Difficulty */}
          <FilterGroup label="Difficulty">
            <div className="flex flex-wrap gap-2">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
                const on = difficulty.has(d);
                const count = stats.byDifficulty.find((x) => x.difficulty === d)?.total ?? 0;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={count === 0 && !on}
                    onClick={() => toggleDifficulty(d)}
                    className={cn(
                      'rounded-control border px-3 py-1.5 text-small transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      on ? 'border-blue bg-blue-tint text-ink-900' : 'border-line text-ink-700 hover:border-ink-400/40',
                    )}
                  >
                    {DIFF_LABEL[d]}
                    <span className="ml-1.5 text-micro text-ink-400">{count}</span>
                  </button>
                );
              })}
            </div>
          </FilterGroup>

          {/* Flagged */}
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-small text-ink-800">
              <Icon name="flag" className="text-small text-blue" />
              Flagged only
            </span>
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => onFlaggedOnly(e.target.checked)}
              className="h-4 w-4 accent-blue"
            />
          </label>
        </CardBody>
      </Card>
    </aside>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      {children}
    </div>
  );
}

function RailRow({
  label,
  count,
  sub,
  active,
  onClick,
}: {
  label: string;
  count: number;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
        active ? 'bg-blue-tint' : 'hover:bg-sunken/70',
      )}
    >
      <span className="min-w-0">
        <span className={cn('block truncate text-small', active ? 'font-semibold text-ink-900' : 'text-ink-700')}>
          {label}
        </span>
        {sub && <span className="block truncate text-micro text-ink-400">{sub}</span>}
      </span>
      <span
        className={cn(
          'shrink-0 rounded-pill px-2 py-0.5 text-micro font-semibold tabular-nums',
          active ? 'bg-blue text-white' : 'bg-sunken text-ink-500',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Error card ───────────────────────────────────────────────────────────── */
function ErrorCard({ item, section }: { item: LogItem; section: Section }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(false);
  const isMath = (item.section ?? section) === 'math';
  const options = (Array.isArray(item.options) ? item.options : []) as Opt[];

  const refresh = () => queryClient.invalidateQueries(trpc.errors.log.queryFilter());

  const setFlag = useMutation(
    trpc.errors.setFlag.mutationOptions({
      onSuccess: () => refresh(),
    }),
  );

  return (
    <Card className={cn('overflow-hidden', item.mastered && 'border-green/30')}>
      <CardBody className="p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge tone="blue">{domainLabel(item.domain)}</Badge>
            {item.skill && <Badge tone="plain">{item.skill}</Badge>}
            {item.difficulty && (
              <span className={cn('rounded-pill px-2 py-0.5 text-micro font-semibold', DIFF_TONE[item.difficulty])}>
                {DIFF_LABEL[item.difficulty]}
              </span>
            )}
            {item.releaseBatch && <Badge tone="new">New</Badge>}
          </div>
          <button
            type="button"
            onClick={() => setFlag.mutate({ questionId: item.questionId, flagged: !item.flagged })}
            disabled={setFlag.isPending}
            aria-pressed={item.flagged}
            title={item.flagged ? 'Remove flag' : 'Flag for review'}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-control transition-colors',
              item.flagged ? 'bg-blue-tint text-blue' : 'text-ink-400 hover:bg-sunken hover:text-ink-600',
            )}
          >
            <Icon name="flag" className="text-small" />
          </button>
        </div>

        {/* Question preview */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="block w-full px-4 text-left"
        >
          <div className={cn('qb-reading text-ink-900', !expanded && 'line-clamp-2')}>
            {isMath ? <MathHtml html={item.questionText} /> : <RichText>{item.questionText}</RichText>}
          </div>
        </button>

        {/* Status line */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-micro text-ink-500">
          <span className="inline-flex items-center gap-1">
            <Icon name="cross-circle" className="text-[11px] text-miss" />
            Missed {item.wrongCount}×
          </span>
          {item.mastered ? (
            <span className="inline-flex items-center gap-1 font-medium text-green">
              <Icon name="checkmark-circle" className="text-[11px]" /> Mastered
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-amber">
              <Icon name="target" className="text-[11px]" /> Not yet mastered
            </span>
          )}
          {item.lastWrongAt && <span>Last missed {formatRelative(item.lastWrongAt)}</span>}
          {item.avgTimeMs != null && <span>~{Math.round(item.avgTimeMs / 1000)}s avg</span>}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 font-medium text-blue hover:underline"
          >
            {expanded ? 'Hide' : 'Review'}
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="text-[11px]" />
          </button>
        </div>

        {/* Expanded review */}
        {expanded && (
          <div className="border-t border-line bg-sunken/30 px-4 py-4">
            {/* Passage / figure */}
            {item.hasVisual && (
              <QuestionFigure url={item.visualUrl} description={item.visualData} className="mb-3" />
            )}
            {item.passage && !isMath && (
              <div className="mb-4 rounded-control border border-line bg-surface px-4 py-3">
                <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-ink-400">Passage</p>
                <p className="qb-reading whitespace-pre-line text-ink-800">
                  <RichText>{item.passage}</RichText>
                </p>
              </div>
            )}

            {retry ? (
              <RetryPanel
                item={item}
                isMath={isMath}
                options={options}
                onDone={refresh}
                onClose={() => setRetry(false)}
              />
            ) : (
              <ReviewPanel item={item} isMath={isMath} options={options} onRetry={() => setRetry(true)} />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Static review: your pick vs. the correct answer, plus the explanation. */
function ReviewPanel({
  item,
  isMath,
  options,
  onRetry,
}: {
  item: LogItem;
  isMath: boolean;
  options: Opt[];
  onRetry: () => void;
}) {
  const isSpr = item.answerFormat === 'spr';
  return (
    <>
      {isSpr ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <AnswerPill tone="miss" label="Your answer" value={item.lastWrongAnswer ?? '—'} />
          <AnswerPill tone="hit" label="Correct answer" value={item.correctAnswer} />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {options.map((o) => {
            const isCorrect = o.letter === item.correctAnswer;
            const isYours = o.letter === item.lastWrongAnswer;
            return (
              <li
                key={o.letter}
                className={cn(
                  'flex items-start gap-3 rounded-control border px-3 py-2',
                  isCorrect
                    ? 'border-green/40 bg-green-tint/50'
                    : isYours
                      ? 'border-miss/40 bg-miss-tint/50'
                      : 'border-line bg-surface',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-bold',
                    isCorrect ? 'bg-green text-white' : isYours ? 'bg-miss text-white' : 'bg-sunken text-ink-500',
                  )}
                >
                  {o.letter}
                </span>
                <span className="qb-reading min-w-0 flex-1 text-ink-800">
                  {isMath ? <MathHtml html={o.text} /> : <RichText>{o.text}</RichText>}
                </span>
                {isCorrect && <Icon name="checkmark-circle" className="mt-0.5 shrink-0 text-body text-green" />}
                {isYours && !isCorrect && (
                  <span className="mt-0.5 shrink-0 text-micro font-semibold text-miss">Your pick</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {item.explanation && (
        <div className="mt-4 rounded-control border border-line bg-surface px-4 py-3">
          <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-ink-400">Explanation</p>
          <div className="qb-reading text-ink-800">
            {isMath ? <MathHtml html={item.explanation} /> : <RichText>{item.explanation}</RichText>}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Button variant="ghost" onClick={onRetry}>
          <Icon name="reload" className="text-small" />
          Try again
        </Button>
      </div>
    </>
  );
}

/** Interactive re-attempt: hides the answer, grades server-side, updates mastery. */
function RetryPanel({
  item,
  isMath,
  options,
  onDone,
  onClose,
}: {
  item: LogItem;
  isMath: boolean;
  options: Opt[];
  onDone: () => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const isSpr = item.answerFormat === 'spr';
  const [picked, setPicked] = useState<string | null>(null);
  const [sprValue, setSprValue] = useState('');
  const [result, setResult] = useState<{ isCorrect: boolean | null; correctAnswer: string; explanation: string | null } | null>(
    null,
  );

  const check = useMutation(
    trpc.questions.check.mutationOptions({
      onSuccess: (res) => {
        setResult(res);
        onDone(); // refresh the log so mastery/last-attempt update
      },
    }),
  );

  const submit = (answer: string) => {
    if (!answer) return;
    check.mutate({ questionId: item.questionId, selectedAnswer: answer });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-small font-semibold text-ink-800">Try it again</p>
        <button type="button" onClick={onClose} className="text-micro text-ink-400 hover:text-ink-600">
          Back to review
        </button>
      </div>

      {isSpr ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(sprValue.trim());
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={sprValue}
            onChange={(e) => setSprValue(e.target.value)}
            placeholder="Type your answer"
            disabled={result != null}
            className="max-w-[12rem]"
          />
          <Button type="submit" disabled={check.isPending || result != null || !sprValue.trim()}>
            {check.isPending ? 'Checking…' : 'Check'}
          </Button>
        </form>
      ) : (
        <ul className="flex flex-col gap-2">
          {options.map((o) => {
            const chosen = picked === o.letter;
            const revealCorrect = result != null && o.letter === (result.correctAnswer ?? item.correctAnswer);
            const revealWrong = result != null && chosen && !revealCorrect;
            return (
              <li key={o.letter}>
                <button
                  type="button"
                  disabled={result != null || check.isPending}
                  onClick={() => {
                    setPicked(o.letter);
                    submit(o.letter);
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-control border px-3 py-2 text-left transition-colors disabled:cursor-default',
                    revealCorrect
                      ? 'border-green/50 bg-green-tint/50'
                      : revealWrong
                        ? 'border-miss/50 bg-miss-tint/50'
                        : chosen
                          ? 'border-blue bg-blue-tint'
                          : 'border-line bg-surface hover:border-ink-400/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-bold',
                      revealCorrect
                        ? 'bg-green text-white'
                        : revealWrong
                          ? 'bg-miss text-white'
                          : 'bg-sunken text-ink-600',
                    )}
                  >
                    {o.letter}
                  </span>
                  <span className="qb-reading min-w-0 flex-1 text-ink-800">
                    {isMath ? <MathHtml html={o.text} /> : <RichText>{o.text}</RichText>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {result && (
        <div
          className={cn(
            'mt-3 rounded-control px-4 py-3',
            result.isCorrect ? 'bg-green-tint' : 'bg-miss-tint',
          )}
        >
          <p className={cn('flex items-center gap-2 text-small font-semibold', result.isCorrect ? 'text-green' : 'text-miss')}>
            <Icon name={result.isCorrect ? 'checkmark-circle' : 'cross-circle'} className="text-body" />
            {result.isCorrect ? 'Correct — nice, that one flips to mastered.' : `Not quite. Correct answer: ${result.correctAnswer}.`}
          </p>
          {result.explanation && (
            <div className="qb-reading mt-2 text-small text-ink-800">
              {isMath ? <MathHtml html={result.explanation} /> : <RichText>{result.explanation}</RichText>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Small bits ───────────────────────────────────────────────────────────── */
function Badge({ tone, children }: { tone: 'blue' | 'plain' | 'new'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-tint text-blue',
    plain: 'bg-sunken text-ink-600',
    new: 'bg-green-tint text-green',
  };
  return (
    <span className={cn('rounded-pill px-2 py-0.5 text-micro font-semibold', tones[tone])}>{children}</span>
  );
}

function AnswerPill({ tone, label, value }: { tone: 'hit' | 'miss'; label: string; value: string }) {
  return (
    <div
      className={cn(
        'rounded-control border px-3 py-2',
        tone === 'hit' ? 'border-green/40 bg-green-tint/50' : 'border-miss/40 bg-miss-tint/50',
      )}
    >
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cn('text-body font-semibold', tone === 'hit' ? 'text-green' : 'text-miss')}>{value}</p>
    </div>
  );
}
