'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Reveal } from '@/components/reveal';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { domainLabel } from '@/lib/labels';
import { useSection, SECTION_LABELS, type Section } from '@/lib/section';
import { domainOrderFor, DSAT_DOMAIN_WEIGHTS, MATH_DOMAIN_WEIGHTS } from '@/lib/dsat';
import { UntimedTaker, type BuiltQuestion } from '@/components/untimed-taker';

/**
 * Domain-browse & custom set builder — modeled on the College Board Question
 * Bank's drill-down (domain → skill), deliberately with no chip/pill filters.
 *
 * Flow: Level 1 (domains + "randomize everything") → Level 2 (skills in a
 * domain, multi-select or "randomize this domain") → customize (count,
 * difficulty, order, exclude-done) → take in a split-pane exam window, one
 * question at a time with a per-question timer, each checked for instant
 * feedback. Every check records the attempt in the unified `answers` table (via
 * `questions.check`), feeding the same analytics as timed tests.
 */

const DOMAIN_TONES: Record<string, { bg: string; ring: string; accent: string }> = {
  // Reading & Writing
  information_and_ideas: { bg: 'bg-amber-tint', ring: 'text-amber', accent: 'bg-amber' },
  craft_and_structure: { bg: 'bg-violet-tint', ring: 'text-violet', accent: 'bg-violet' },
  expression_of_ideas: { bg: 'bg-green-tint', ring: 'text-green', accent: 'bg-green' },
  standard_english_conventions: { bg: 'bg-blue-tint', ring: 'text-blue', accent: 'bg-blue' },
  // Math
  algebra: { bg: 'bg-blue-tint', ring: 'text-blue', accent: 'bg-blue' },
  advanced_math: { bg: 'bg-violet-tint', ring: 'text-violet', accent: 'bg-violet' },
  problem_solving_data_analysis: { bg: 'bg-amber-tint', ring: 'text-amber', accent: 'bg-amber' },
  geometry_trigonometry: { bg: 'bg-green-tint', ring: 'text-green', accent: 'bg-green' },
};

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

type ByDifficulty = { easy: number; medium: number; hard: number };

/** Difficulty → dot hue, reusing the app's semantic tints (easy = calm green,
 *  medium = amber, hard = miss/red). Kept as a tiny colored pip so the split
 *  reads at a glance without shouting. */
const DIFF_DOT: Record<Difficulty, string> = {
  easy: 'bg-green',
  medium: 'bg-amber',
  hard: 'bg-miss',
};

type Scope =
  | { kind: 'all' }
  | { kind: 'domain'; domain: string }
  | { kind: 'skills'; domain: string; skills: string[] };


const EXCLUDE_ACTIVE_KEY = 'qb:excludeActive';
const COHORT_KEY = 'qb:cohort';
const CATEGORY_KEY = 'qb:category';

/** Which release cohort the browse view is scoped to. */
type Cohort = 'all' | 'original' | 'new';
const COHORTS: { value: Cohort; label: string; hint: string }[] = [
  { value: 'original', label: 'Original', hint: 'The original question pool' },
  { value: 'new', label: 'New', hint: 'Latest Bluebook release' },
  { value: 'all', label: 'All', hint: 'Original + new, combined' },
];

/**
 * Which question category the whole page is scoped to. These two pools are
 * disjoint and deliberately never mixed:
 *  - 'question_bank'    — the College Board Question Bank (the bulk ingests).
 *  - 'digital_sat_1600' — "The Digital SAT 1600": the sets the user pasted in.
 */
type Category = 'question_bank' | 'digital_sat_1600';
const CATEGORIES: { value: Category; label: string; hint: string }[] = [
  { value: 'question_bank', label: 'Question Bank', hint: 'The College Board question bank' },
  { value: 'digital_sat_1600', label: 'The Digital SAT 1600', hint: 'The practice sets you added' },
];

export default function QuestionBankPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const { section } = useSection();
  const DOMAIN_ORDER = domainOrderFor(section);

  // "Exclude active Bluebook questions" — a sticky, page-wide preference. It
  // recomputes every section count and is carried into every set the user
  // builds, so once it's on they never practice a live question by accident.
  const [excludeActive, setExcludeActiveState] = useState(false);
  useEffect(() => {
    setExcludeActiveState(localStorage.getItem(EXCLUDE_ACTIVE_KEY) === '1');
  }, []);
  const setExcludeActive = (v: boolean) => {
    setExcludeActiveState(v);
    try {
      localStorage.setItem(EXCLUDE_ACTIVE_KEY, v ? '1' : '0');
    } catch {
      /* private mode / storage disabled — the toggle still works for the session */
    }
  };

  // "Original vs New vs All" — a sticky, page-wide release cohort. It keeps the
  // newly-released Bluebook batch on its own switch instead of mixing it into
  // the original pool. Defaults to 'original', so existing practice is unchanged
  // until the user deliberately switches to the new questions.
  const [cohort, setCohortState] = useState<Cohort>('original');
  useEffect(() => {
    const saved = localStorage.getItem(COHORT_KEY);
    if (saved === 'all' || saved === 'original' || saved === 'new') setCohortState(saved);
  }, []);
  const setCohort = (v: Cohort) => {
    setCohortState(v);
    try {
      localStorage.setItem(COHORT_KEY, v);
    } catch {
      /* private mode / storage disabled — the switch still works for the session */
    }
  };

  // "Question Bank vs The Digital SAT 1600" — the outermost, page-wide scope.
  // The College Board bank and the user's pasted practice sets are kept as two
  // separate pools; this switch chooses which one the whole page draws from.
  // Defaults to the College Board bank so existing practice is unchanged.
  const [category, setCategoryState] = useState<Category>('question_bank');
  useEffect(() => {
    const saved = localStorage.getItem(CATEGORY_KEY);
    if (saved === 'question_bank' || saved === 'digital_sat_1600') setCategoryState(saved);
  }, []);
  const setCategory = (v: Category) => {
    setCategoryState(v);
    try {
      localStorage.setItem(CATEGORY_KEY, v);
    } catch {
      /* private mode / storage disabled — the switch still works for the session */
    }
  };

  // The release cohort only means something for the College Board bank (the
  // pasted sets carry no Bluebook release). In "The Digital SAT 1600" we hide
  // the cohort switch and draw from the whole category regardless of the saved
  // cohort, so switching categories never lands the user on an empty pool.
  const effectiveCohort: Cohort = category === 'digital_sat_1600' ? 'all' : cohort;

  // Counts drive the drill-down and recompute whenever a filter flips; the
  // customize step layers difficulty/exclusion on top and reports the pool size.
  const counts = useQuery(
    trpc.questions.domainCounts.queryOptions({ section, excludeActive, cohort: effectiveCohort, category }),
  );

  // Full totals per category (ignoring the other filters) — power the badges on
  // the category switch so each pool advertises its size for this section.
  const questionBankCount = useQuery(
    trpc.questions.domainCounts.queryOptions({ section, cohort: 'all', category: 'question_bank' }),
  );
  const digitalSatCount = useQuery(
    trpc.questions.domainCounts.queryOptions({ section, cohort: 'all', category: 'digital_sat_1600' }),
  );

  // The same counts, but of only the questions the user hasn't done yet. Diffing
  // the two gives a subtle "how much is left in this category" indicator without
  // any new backend work — `excludeCompleted` reuses the exact set-builder logic,
  // so the number shown is what a fresh set would actually draw from.
  const remaining = useQuery(
    trpc.questions.domainCounts.queryOptions({
      section,
      excludeActive,
      cohort: effectiveCohort,
      category,
      excludeCompleted: true,
    }),
  );

  // Size of the newly-released batch (independent of the current cohort), so the
  // "New" switch can advertise how many questions it holds for this section. The
  // release cohorts only exist within the College Board bank.
  const newCounts = useQuery(
    trpc.questions.domainCounts.queryOptions({ section, excludeActive, cohort: 'new', category: 'question_bank' }),
  );

  // `null` = still loading (unknown); a number = the not-yet-done count. A domain
  // or skill that's fully completed simply drops out of `remaining`, so an absent
  // entry means 0 left, not "unknown".
  const remainingDomain = (d: string): number | null =>
    remaining.data ? remaining.data.domains.find((x) => x.domain === d)?.total ?? 0 : null;
  const remainingSkill = (d: string, skill: string): number | null =>
    remaining.data
      ? remaining.data.domains.find((x) => x.domain === d)?.skills.find((s) => s.skill === skill)
          ?.total ?? 0
      : null;
  // The same not-yet-done pool, split by difficulty — feeds the subtle
  // easy/medium/hard tally under each skill. Absent entry = nothing left, so a
  // zeroed bucket is correct, not unknown.
  const remainingSkillByDifficulty = (d: string, skill: string): ByDifficulty | null =>
    remaining.data
      ? remaining.data.domains.find((x) => x.domain === d)?.skills.find((s) => s.skill === skill)
          ?.byDifficulty ?? { easy: 0, medium: 0, hard: 0 }
      : null;

  const [domain, setDomain] = useState<string | null>(null); // null = Level 1
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [customize, setCustomize] = useState<Scope | null>(null);
  const [session, setSession] = useState<{ questions: BuiltQuestion[]; label: string } | null>(null);
  const [examOpen, setExamOpen] = useState(false);

  // Switching section resets the drill-down — an R&W domain is meaningless in math.
  useEffect(() => {
    setDomain(null);
    setSelectedSkills(new Set());
  }, [section]);

  if (session) {
    return (
      <UntimedTaker
        questions={session.questions}
        scopeLabel={session.label}
        onExit={() => setSession(null)}
      />
    );
  }

  const domainData = domain ? counts.data?.domains.find((d) => d.domain === domain) : null;

  const scopeLabel = (s: Scope): string => {
    if (s.kind === 'all') return 'Mixed — all domains';
    if (s.kind === 'domain') return `${domainLabel(s.domain)} — all skills`;
    return `${domainLabel(s.domain)} — ${s.skills.length} skill${s.skills.length === 1 ? '' : 's'}`;
  };

  // How much of the pool sits at each difficulty — drives the exam-module card's
  // "N hard available" line and the modal's live availability check.
  const poolByDiff = { easy: 0, medium: 0, hard: 0, total: counts.data?.total ?? 0 };
  for (const d of counts.data?.domains ?? []) {
    poolByDiff.easy += d.byDifficulty.easy;
    poolByDiff.medium += d.byDifficulty.medium;
    poolByDiff.hard += d.byDifficulty.hard;
  }

  return (
    <>
      {domain === null ? (
        /* ── Level 1: domains ───────────────────────────────────────────── */
        <>
          <PageHeader
            title={category === 'digital_sat_1600' ? 'The Digital SAT 1600' : 'Question Bank'}
            description={
              category === 'digital_sat_1600'
                ? 'The practice sets you added, kept separate from the College Board bank. Browse by domain and skill, then build a custom, untimed set.'
                : 'Browse by domain and skill, then build a custom, untimed set — the answer on demand after each question.'
            }
          />

          <CategorySwitch
            value={category}
            onChange={setCategory}
            questionBankCount={questionBankCount.data?.total ?? null}
            digitalSatCount={digitalSatCount.data?.total ?? null}
          />

          {/* Release cohorts only exist within the College Board bank. */}
          {category === 'question_bank' && (
            <CohortSwitch value={cohort} onChange={setCohort} newCount={newCounts.data?.total ?? null} />
          )}

          <ExcludeActiveToggle value={excludeActive} onChange={setExcludeActive} />

          <ExamModuleCard
            section={section}
            hardAvailable={poolByDiff.hard}
            total={poolByDiff.total}
            onBuild={() => setExamOpen(true)}
          />

          {counts.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-card border border-line bg-sunken/50" />
              ))}
            </div>
          ) : (
            <>
              <Reveal stagger className="grid gap-4 sm:grid-cols-2">
                {DOMAIN_ORDER.map((d) => {
                  const dc = counts.data?.domains.find((x) => x.domain === d);
                  const total = dc?.total ?? 0;
                  const tone = DOMAIN_TONES[d];
                  const left = remainingDomain(d);
                  const doneFrac =
                    left !== null && total > 0 ? Math.min(1, Math.max(0, (total - left) / total)) : 0;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={total === 0}
                      onClick={() => {
                        setSelectedSkills(new Set());
                        setDomain(d);
                      }}
                      className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue rounded-card disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Card interactive className={cn('relative overflow-hidden border-transparent', tone.bg)}>
                        <CardBody className="flex items-center justify-between gap-4">
                          <div>
                            <h3 className="text-h3 font-semibold text-ink-900">{domainLabel(d)}</h3>
                            <p className="mt-0.5 text-small text-ink-600">
                              {dc?.skills.length ?? 0} skill{(dc?.skills.length ?? 0) === 1 ? '' : 's'}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-h2 font-semibold text-ink-900 tabular-nums">{total}</p>
                              {/* Same slot as the old "questions" label, now doing double
                                  duty as the remaining-work indicator once you've started. */}
                              <p className={cn('text-micro', left != null && left > 0 && left < total ? tone.ring : 'text-ink-500')}>
                                {left == null || left === total
                                  ? 'questions'
                                  : left === 0
                                    ? 'all done'
                                    : `${left} left`}
                              </p>
                            </div>
                            <Icon name="chevron-right" className={cn('text-body', tone.ring)} />
                          </div>
                        </CardBody>

                        {/* Progress sliver — invisible until you've done at least one, so a
                            fresh category looks untouched; fills in the domain's own hue. */}
                        {doneFrac > 0 && (
                          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-ink-900/[0.06]">
                            <span
                              className={cn('block h-full rounded-r-full transition-[width] duration-500', tone.accent)}
                              style={{ width: `${doneFrac * 100}%` }}
                            />
                          </span>
                        )}
                      </Card>
                    </button>
                  );
                })}
              </Reveal>

              {/* Distinct top-level "mix everything" option. */}
              <Card className="mt-4 border-blue/10 bg-blue-wash">
                <CardBody className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-h3 font-semibold text-ink-900">Randomize across everything</h3>
                    <p className="mt-0.5 text-small text-ink-600">
                      A fully mixed set drawn from all {counts.data?.total ?? 0} verified questions, not
                      scoped to one domain.
                    </p>
                  </div>
                  <Button
                    onClick={() => setCustomize({ kind: 'all' })}
                    disabled={(counts.data?.total ?? 0) === 0}
                  >
                    Build a set
                    <Icon name="arrow-right" className="text-small" />
                  </Button>
                </CardBody>
              </Card>
            </>
          )}
        </>
      ) : (
        /* ── Level 2: skills within a domain ────────────────────────────── */
        <>
          <button
            type="button"
            onClick={() => setDomain(null)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-control text-small font-medium text-ink-500 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
          >
            <Icon name="arrow-left" className="text-small" />
            All domains
          </button>

          <PageHeader
            title={domainLabel(domain)}
            description="Pick one or more skills to build from, or randomize the whole domain."
          />

          <div className="space-y-2">
            {(domainData?.skills ?? []).map((s) => {
              const on = selectedSkills.has(s.skill);
              const left = remainingSkill(domain, s.skill);
              const byDiff = remainingSkillByDifficulty(domain, s.skill);
              const tone = DOMAIN_TONES[domain];
              const doneFrac =
                left !== null && s.total > 0 ? Math.min(1, Math.max(0, (s.total - left) / s.total)) : 0;
              return (
                <button
                  key={s.skill}
                  type="button"
                  onClick={() =>
                    setSelectedSkills((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.skill)) next.delete(s.skill);
                      else next.add(s.skill);
                      return next;
                    })
                  }
                  className={cn(
                    'relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-card border px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                    on ? 'border-blue bg-blue-tint' : 'border-line hover:border-ink-400/40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                        on ? 'border-blue bg-blue text-white' : 'border-ink-400',
                      )}
                    >
                      {on && <Icon name="checkmark" className="text-micro" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-ink-900">{s.skill}</span>
                      {/* Subtle easy/medium/hard split of what's still left — three
                          tinted pips, muted numbers, hidden once the skill is done. */}
                      {byDiff && (left == null || left > 0) && (
                        <DifficultySplit by={byDiff} />
                      )}
                    </span>
                  </span>

                  {/* Remaining / total. The remaining figure is what the user asked for —
                      how many are left to do — kept subtle with the total muted beside it. */}
                  {left === 0 && s.total > 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-small font-medium text-green">
                      <Icon name="checkmark-circle" className="text-body" />
                      Done
                    </span>
                  ) : (
                    <span className="shrink-0 text-small tabular-nums">
                      <span className={cn('font-semibold', left != null && left < s.total ? 'text-ink-900' : 'text-ink-500')}>
                        {left ?? s.total}
                      </span>
                      {left != null && left < s.total && <span className="text-ink-400"> / {s.total}</span>}
                    </span>
                  )}

                  {/* Matching sliver, only after some progress — same language as the cards. */}
                  {doneFrac > 0 && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-ink-900/[0.05]">
                      <span
                        className={cn('block h-full rounded-r-full transition-[width] duration-500', tone.accent)}
                        style={{ width: `${doneFrac * 100}%` }}
                      />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setCustomize({ kind: 'domain', domain })}>
              <Icon name="reload" className="text-small" />
              Randomize this domain
            </Button>
            <Button
              disabled={selectedSkills.size === 0}
              onClick={() =>
                setCustomize({ kind: 'skills', domain, skills: Array.from(selectedSkills) })
              }
            >
              Build from {selectedSkills.size} skill{selectedSkills.size === 1 ? '' : 's'}
              <Icon name="arrow-right" className="text-small" />
            </Button>
          </div>
        </>
      )}

      <CustomizeModal
        scope={customize}
        section={section}
        scopeLabel={customize ? scopeLabel(customize) : ''}
        excludeActive={excludeActive}
        cohort={effectiveCohort}
        category={category}
        onClose={() => setCustomize(null)}
        onBuilt={(questions, label) => {
          setSession({ questions, label });
          setCustomize(null);
        }}
      />

      <ExamModuleModal
        open={examOpen}
        section={section}
        cohort={effectiveCohort}
        category={category}
        excludeActive={excludeActive}
        poolByDiff={poolByDiff}
        onClose={() => setExamOpen(false)}
        onStart={(attemptId) => router.push(`/test/${attemptId}`)}
      />
    </>
  );
}

/* ── Category switch ─────────────────────────────────────────────────────── */

/**
 * The outermost, page-wide scope: the College Board "Question Bank" vs "The
 * Digital SAT 1600" (the sets the user pasted in). The two pools are disjoint
 * and never mixed — this switch chooses which one the entire page (counts,
 * drill-down, custom sets, exam modules) draws from. Each segment advertises how
 * many questions its pool holds for the current section. Persisted like the
 * other page-wide switches; defaults to the College Board bank.
 */
function CategorySwitch({
  value,
  onChange,
  questionBankCount,
  digitalSatCount,
}: {
  value: Category;
  onChange: (v: Category) => void;
  questionBankCount: number | null;
  digitalSatCount: number | null;
}) {
  const countFor = (c: Category) =>
    c === 'question_bank' ? questionBankCount : digitalSatCount;
  return (
    <div className="mb-3">
      <div
        role="tablist"
        aria-label="Question category"
        className="inline-flex w-full gap-1 rounded-control border border-line bg-surface p-1"
      >
        {CATEGORIES.map((c) => {
          const on = value === c.value;
          const count = countFor(c.value);
          return (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={on}
              title={c.hint}
              onClick={() => onChange(c.value)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-[calc(theme(borderRadius.control)-2px)] px-4 py-2 text-small font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                on ? 'bg-blue text-white shadow-sm' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {c.label}
              {count !== null && (
                <span
                  className={cn(
                    'rounded-pill px-1.5 py-0.5 text-micro font-semibold tabular-nums',
                    on ? 'bg-white/20 text-white' : 'bg-blue-tint text-blue',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-micro text-ink-500">
        {value === 'digital_sat_1600'
          ? 'Showing the practice sets you added — kept separate from the College Board question bank.'
          : 'Showing the College Board question bank — your added practice sets are under “The Digital SAT 1600.”'}
      </p>
    </div>
  );
}

/* ── Release-cohort switch ───────────────────────────────────────────────── */

/**
 * The page-wide "Original / New / All" release switch. Bluebook periodically
 * releases new questions; rather than folding them into the original pool, this
 * segmented control lets the user view each cohort on its own (or combined). It
 * feeds every count and every built set, and its choice is persisted. The "New"
 * segment advertises how many questions the latest release added for the current
 * section.
 */
function CohortSwitch({
  value,
  onChange,
  newCount,
}: {
  value: Cohort;
  onChange: (v: Cohort) => void;
  newCount: number | null;
}) {
  return (
    <div className="mb-3">
      <div
        role="tablist"
        aria-label="Question release cohort"
        className="inline-flex w-full gap-1 rounded-control border border-line bg-surface p-1 sm:w-auto"
      >
        {COHORTS.map((c) => {
          const on = value === c.value;
          const showCount = c.value === 'new' && newCount !== null;
          return (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={on}
              title={c.hint}
              onClick={() => onChange(c.value)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-[calc(theme(borderRadius.control)-2px)] px-4 py-1.5 text-small font-medium transition-colors sm:flex-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                on ? 'bg-blue text-white shadow-sm' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {c.value === 'new' && (
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    on ? 'bg-white' : newCount ? 'bg-blue' : 'bg-ink-400/60',
                  )}
                />
              )}
              {c.label}
              {showCount && (
                <span
                  className={cn(
                    'rounded-pill px-1.5 py-0.5 text-micro font-semibold tabular-nums',
                    on ? 'bg-white/20 text-white' : 'bg-blue-tint text-blue',
                  )}
                >
                  {newCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-micro text-ink-500">
        {value === 'original'
          ? 'Showing the original question pool — newly-released questions are kept separate.'
          : value === 'new'
            ? 'Showing only the latest Bluebook release.'
            : 'Showing the original pool and the latest release together.'}
      </p>
    </div>
  );
}

/* ── Exclude-active toggle ───────────────────────────────────────────────── */

/**
 * The page-wide switch for hiding questions still live in Bluebook. A slim,
 * single-line bar — noticeable via a status dot + a soft green wash when on, but
 * far quieter than a full card. Its state is persisted and fed into every count
 * and every built set.
 */
function ExcludeActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label="Exclude active Bluebook questions"
      onClick={() => onChange(!value)}
      className={cn(
        'group mb-6 flex w-full items-center justify-between gap-4 rounded-control border px-4 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
        value ? 'border-green/10 bg-green-tint/50' : 'border-line bg-surface hover:border-ink-400/40',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full transition-colors',
            value ? 'bg-green' : 'bg-ink-400/60',
          )}
        />
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-small font-medium text-ink-900">Exclude active Bluebook questions</span>
          <span className="text-micro text-ink-500">
            {value ? 'On — showing only disclosed questions' : 'Hide questions still live in the practice tests in the official app'}
          </span>
        </span>
      </span>

      {/* Visual switch (the whole bar is the control) */}
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill transition-colors',
          value ? 'bg-green' : 'bg-ink-400/50 group-hover:bg-ink-400/70',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
            value ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

/* ── Difficulty split ────────────────────────────────────────────────────── */

/**
 * A whisper-quiet "what's left, by difficulty" line for a skill row: three
 * tinted pips (easy = green, medium = amber, hard = miss) each with its
 * remaining count in muted micro text. A depleted bucket dims to ink-300/400
 * rather than disappearing, so the shape stays stable and "0 easy left" still
 * reads. The `title` gives the full sentence for hover/screen-reader.
 */
function DifficultySplit({ by }: { by: ByDifficulty }) {
  const title = `${by.easy} easy · ${by.medium} medium · ${by.hard} hard left`;
  return (
    <span
      className="mt-1 flex items-center gap-2.5 text-micro tabular-nums text-ink-500"
      title={title}
      aria-label={title}
    >
      {DIFFICULTIES.map((d) => {
        const n = by[d.value];
        return (
          <span key={d.value} className="flex items-center gap-1">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                n > 0 ? DIFF_DOT[d.value] : 'bg-ink-300',
              )}
            />
            <span className={n > 0 ? 'text-ink-600' : 'text-ink-400'}>{n}</span>
          </span>
        );
      })}
    </span>
  );
}

/* ── Customize modal ─────────────────────────────────────────────────────── */

function CustomizeModal({
  scope,
  section,
  scopeLabel,
  excludeActive,
  cohort,
  category,
  onClose,
  onBuilt,
}: {
  scope: Scope | null;
  section: 'reading_writing' | 'math';
  scopeLabel: string;
  excludeActive: boolean;
  cohort: Cohort;
  category: Category;
  onClose: () => void;
  onBuilt: (questions: BuiltQuestion[], label: string) => void;
}) {
  const trpc = useTRPC();
  const [count, setCount] = useState(10);
  const [difficulties, setDifficulties] = useState<Set<Difficulty>>(new Set());
  const [excludeCompleted, setExcludeCompleted] = useState(false);
  const [order, setOrder] = useState<'random' | 'in_order'>('random');
  const [error, setError] = useState<string | null>(null);

  const build = useMutation(
    trpc.questions.buildCustomSet.mutationOptions({
      onSuccess: (res) => {
        onBuilt(res.questions as unknown as BuiltQuestion[], scopeLabel);
      },
      onError: (e) => setError(e.message),
    }),
  );

  const start = () => {
    if (!scope) return;
    setError(null);
    const diff = Array.from(difficulties);
    const base = {
      section,
      count,
      difficulty: diff.length ? diff : undefined,
      excludeCompleted,
      excludeActive,
      cohort,
      category,
      order,
    };
    if (scope.kind === 'all') build.mutate(base);
    else if (scope.kind === 'domain')
      build.mutate({ ...base, domains: [scope.domain] as never });
    else build.mutate({ ...base, skills: scope.skills });
  };

  return (
    <Modal
      open={scope !== null}
      onClose={onClose}
      title="Build your set"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start} disabled={build.isPending}>
            {build.isPending ? 'Building…' : 'Start set'}
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-control bg-sunken px-3 py-2 text-small text-ink-700">{scopeLabel}</p>

        <Input
          label="Questions"
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          hint="1–50"
          className="max-w-[10rem]"
        />

        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Difficulty</p>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((d) => {
              const on = difficulties.has(d.value);
              return (
                <label
                  key={d.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-small transition-colors',
                    on ? 'border-blue bg-blue-tint text-ink-900' : 'border-line text-ink-700',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDifficulties((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.value)) next.delete(d.value);
                        else next.add(d.value);
                        return next;
                      })
                    }
                    className="h-4 w-4 accent-blue"
                  />
                  {d.label}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-micro text-ink-400">Leave all unchecked for any difficulty.</p>
        </div>

        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Order</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'random', label: 'Random', hint: 'Shuffled draw' },
              { value: 'in_order', label: 'In order', hint: 'By question number' },
            ] as const).map((o) => {
              const on = order === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOrder(o.value)}
                  className={cn(
                    'rounded-control border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-blue bg-blue-tint' : 'border-line hover:border-ink-400/40',
                  )}
                >
                  <span className="block text-small font-medium text-ink-900">{o.label}</span>
                  <span className="block text-micro text-ink-500">{o.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-control border border-line px-3 py-2.5">
          <input
            type="checkbox"
            checked={excludeCompleted}
            onChange={(e) => setExcludeCompleted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue"
          />
          <span>
            <span className="block text-small font-medium text-ink-900">
              Exclude questions I’ve already done
            </span>
            <span className="block text-micro text-ink-500">
              Skips anything you’ve completed in a test or here.
            </span>
          </span>
        </label>

        {/* Release cohort is a page-wide setting; confirm which pool this set is
            drawn from when it isn't the default combined view. */}
        {cohort !== 'all' && (
          <p className="flex items-center gap-2 rounded-control bg-blue-tint px-3 py-2.5 text-small text-blue">
            <Icon name="checkmark-circle" className="shrink-0 text-body" />
            {cohort === 'new'
              ? 'Drawn only from the latest Bluebook release.'
              : 'Drawn only from the original question pool.'}
          </p>
        )}

        {/* Active-question exclusion is a page-wide setting; this just confirms
            it's being applied to the set the user is about to build. */}
        {excludeActive && (
          <p className="flex items-center gap-2 rounded-control bg-green-tint px-3 py-2.5 text-small text-green">
            <Icon name="checkmark-circle" className="shrink-0 text-body" />
            Active Bluebook questions are excluded from this set.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ── Exam module: build a timed, SAT-faithful module from the pool ─────────── */

/**
 * The Question Bank's headline call-to-action: unlike the untimed drill sets
 * below it, this builds a full, timed, Bluebook-style module straight from the
 * verified pool — balanced to the official domain mix and ordered like the real
 * exam. Defaults to hard, the point of the feature.
 */
function ExamModuleCard({
  section,
  hardAvailable,
  total,
  onBuild,
}: {
  section: Section;
  hardAvailable: number;
  total: number;
  onBuild: () => void;
}) {
  return (
    <Card className="relative mb-6 overflow-hidden border-blue/12 bg-gradient-to-br from-blue-wash via-surface to-violet-tint/25">
      <CardBody className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        {/* Pitch */}
        <div className="min-w-0 max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-blue/10 px-2.5 py-1 text-micro font-semibold uppercase tracking-[0.08em] text-blue">
            <Icon name="alarm-clock" className="text-[10px]" />
            Timed · Bluebook-style
          </span>
          <h3 className="mt-2.5 text-h2 font-semibold text-ink-900">Build an exam module</h3>
          <p className="mt-1.5 text-small text-ink-500">
            A full {SECTION_LABELS[section]} module drawn from the questions you already have —
            balanced to the real SAT domain mix and ordered exactly like the exam. Hard by default.
          </p>
          <p className="mt-2.5 flex items-center gap-1.5 text-micro text-ink-500 tabular-nums">
            <span className={cn('h-1.5 w-1.5 rounded-full', hardAvailable > 0 ? 'bg-green' : 'bg-ink-400/60')} />
            {hardAvailable} hard question{hardAvailable === 1 ? '' : 's'} ready
          </p>
        </div>

        {/* A little "module preview": the real domain blueprint + specs + CTA. */}
        <div className="relative w-full shrink-0 overflow-hidden rounded-card border border-white/70 bg-white/55 p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)] backdrop-blur-sm lg:w-72">
          {/* A faint answer-bubble motif in the corner — signals "exam" quietly. */}
          <BubbleMotif className="pointer-events-none absolute -right-5 -top-4 text-blue/[0.08]" />

          <div className="relative mb-3 flex items-center justify-between">
            <span className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-500">
              {SECTION_LABELS[section]} blueprint
            </span>
            <span className="inline-flex items-center gap-1 rounded-pill bg-miss-tint px-2 py-0.5 text-micro font-semibold text-miss">
              <Icon name="bolt" className="text-[10px]" />
              Hard
            </span>
          </div>

          <DomainMixBar section={section} />

          <div className="mt-3 flex items-center gap-2.5 text-micro font-medium text-ink-700">
            <span className="inline-flex items-center gap-1">
              <Icon name="grid-alt" className="text-micro" />
              27 questions
            </span>
            <span className="text-ink-400">·</span>
            <span className="inline-flex items-center gap-1">
              <Icon name="alarm-clock" className="text-micro" />
              35 min
            </span>
          </div>

          <Button className="mt-4 w-full" onClick={onBuild} disabled={total === 0}>
            Build module
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * The section's official domain split as a slim segmented bar plus a two-column
 * legend — the same tones the domain cards use below, so the mix reads as "this
 * is the real SAT blueprint" at a glance. Purely illustrative of the recipe.
 */
function DomainMixBar({ section }: { section: Section }) {
  const weights = section === 'math' ? MATH_DOMAIN_WEIGHTS : DSAT_DOMAIN_WEIGHTS;
  const entries = Object.entries(weights) as [string, number][];
  return (
    <div>
      <div className="flex h-2.5 gap-1">
        {entries.map(([d, w]) => (
          <span
            key={d}
            className={cn('h-full rounded-[3px]', DOMAIN_TONES[d]?.accent ?? 'bg-ink-400')}
            style={{ width: `${w * 100}%` }}
            title={`${domainLabel(d)} · ${Math.round(w * 100)}%`}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {entries.map(([d, w]) => (
          <span key={d} className="flex items-center gap-1.5 text-[11px] text-ink-500">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOMAIN_TONES[d]?.accent ?? 'bg-ink-400')} />
            <span className="truncate">{domainLabel(d).split(' ')[0]}</span>
            <span className="ml-auto tabular-nums text-ink-400">{Math.round(w * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Decorative bubble-sheet grid: a few answer bubbles, one "filled" per row. */
function BubbleMotif({ className }: { className?: string }) {
  const filledPerRow = [1, 3, 0]; // which column reads as marked, per row
  return (
    <svg width="176" height="104" viewBox="0 0 176 104" fill="none" aria-hidden className={className}>
      {filledPerRow.map((filled, r) =>
        [0, 1, 2, 3].map((c) => (
          <circle
            key={`${r}-${c}`}
            cx={20 + c * 44}
            cy={20 + r * 34}
            r="12"
            stroke="currentColor"
            strokeWidth="2.5"
            fill={c === filled ? 'currentColor' : 'none'}
          />
        )),
      )}
    </svg>
  );
}

type ExamDifficulty = 'hard' | 'medium' | 'easy' | 'mixed';
const EXAM_DIFFICULTIES: { value: ExamDifficulty; label: string }[] = [
  { value: 'hard', label: 'Hard' },
  { value: 'medium', label: 'Medium' },
  { value: 'easy', label: 'Easy' },
  { value: 'mixed', label: 'Mixed' },
];

/**
 * Configure and launch a timed exam module. Difficulty defaults to hard; the
 * count (27) and timer (35 min) default to one standard sitting but are fully
 * tweakable. On start it opens a real timed sitting in the Bluebook taker, so
 * answering, flagging, and review all match a live section.
 */
function ExamModuleModal({
  open,
  section,
  cohort,
  category,
  excludeActive,
  poolByDiff,
  onClose,
  onStart,
}: {
  open: boolean;
  section: Section;
  cohort: Cohort;
  category: Category;
  excludeActive: boolean;
  poolByDiff: { easy: number; medium: number; hard: number; total: number };
  onClose: () => void;
  onStart: (attemptId: string) => void;
}) {
  const trpc = useTRPC();
  const [difficulty, setDifficulty] = useState<ExamDifficulty>('hard');
  const [count, setCount] = useState(27);
  const [minutes, setMinutes] = useState(35);
  const [excludeCompleted, setExcludeCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = difficulty === 'mixed' ? poolByDiff.total : poolByDiff[difficulty];

  const start = useMutation(
    trpc.tests.start.mutationOptions({
      onSuccess: (res) => onStart(res.attemptId),
      onError: (e) => setError(e.message),
    }),
  );

  const begin = () => {
    setError(null);
    start.mutate({
      adhoc: {
        section,
        difficulty: difficulty === 'mixed' ? undefined : [difficulty],
        count,
        cohort,
        category,
        excludeActive,
        excludeCompleted,
      },
      timed: true,
      timerSeconds: minutes * 60,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Build an exam module"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button onClick={begin} disabled={start.isPending || available === 0}>
            {start.isPending ? 'Starting…' : `Start · ${minutes} min`}
            <Icon name="arrow-right" className="text-small" />
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="rounded-control bg-blue-wash px-3 py-2 text-small text-ink-600">
          {SECTION_LABELS[section]} · balanced to the official SAT domain mix and ordered like a real
          module. Runs under a countdown, Bluebook-style — no feedback until you submit.
        </p>

        {/* Difficulty — the whole point is hard, but tweakable. */}
        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Difficulty</p>
          <div className="grid grid-cols-4 gap-2">
            {EXAM_DIFFICULTIES.map((d) => {
              const on = difficulty === d.value;
              const n = d.value === 'mixed' ? poolByDiff.total : poolByDiff[d.value];
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDifficulty(d.value)}
                  className={cn(
                    'rounded-control border px-2 py-2 text-center transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                    on ? 'border-blue bg-blue-tint' : 'border-line hover:border-ink-400/40',
                  )}
                >
                  <span className="block text-small font-medium text-ink-900">{d.label}</span>
                  <span className="block text-micro text-ink-500 tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <Input
            label="Questions"
            type="number"
            min={1}
            max={Math.max(1, available)}
            value={count}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
            }
            hint={`up to ${available} available`}
            className="max-w-[9rem]"
          />
          <Input
            label="Timer (minutes)"
            type="number"
            min={5}
            max={180}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(5, Math.min(180, Number(e.target.value) || 5)))}
            hint="auto-submits at zero"
            className="max-w-[9rem]"
          />
        </div>

        <p className="text-micro text-ink-400">
          A real Bluebook module is 27 questions in Reading &amp; Writing (32 min) and 22 in Math
          (35 min). Tweak to match, or make your own.
        </p>

        <label className="flex cursor-pointer items-start gap-3 rounded-control border border-line px-3 py-2.5">
          <input
            type="checkbox"
            checked={excludeCompleted}
            onChange={(e) => setExcludeCompleted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue"
          />
          <span>
            <span className="block text-small font-medium text-ink-900">
              Only questions I haven’t done
            </span>
            <span className="block text-micro text-ink-500">
              Skips anything you’ve completed in a test or the bank.
            </span>
          </span>
        </label>

        {/* Confirm the page-wide scopes this module inherits. */}
        {(cohort !== 'all' || excludeActive) && (
          <div className="space-y-1.5">
            {cohort !== 'all' && (
              <p className="flex items-center gap-2 rounded-control bg-blue-tint px-3 py-2 text-small text-blue">
                <Icon name="checkmark-circle" className="shrink-0 text-body" />
                {cohort === 'new'
                  ? 'Drawn only from the latest Bluebook release.'
                  : 'Drawn only from the original question pool.'}
              </p>
            )}
            {excludeActive && (
              <p className="flex items-center gap-2 rounded-control bg-green-tint px-3 py-2 text-small text-green">
                <Icon name="checkmark-circle" className="shrink-0 text-body" />
                Active Bluebook questions are excluded.
              </p>
            )}
          </div>
        )}

        {available === 0 && (
          <p className="rounded-control bg-amber-tint px-3 py-2 text-small text-ink-700">
            No {difficulty === 'mixed' ? '' : `${difficulty} `}questions available for this section
            and cohort. Try another difficulty or switch cohort.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
