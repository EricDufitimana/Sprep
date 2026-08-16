/**
 * Assemble one SAT-faithful exam module from a verified question pool.
 *
 * This is what makes a "built" module read like a real Bluebook section rather
 * than a random pile:
 *
 *   1. **Mix** — the domains are drawn in the official proportions for the
 *      section (College Board's published R&W / Math distributions), capped at
 *      what the pool actually holds and backfilled when a domain runs short
 *      (via `balanceDsat`).
 *   2. **Order** — the chosen questions are laid out the way a real module
 *      presents them:
 *        • Reading & Writing groups questions into domain blocks in a fixed
 *          sequence (Craft & Structure → Information & Ideas → Standard English
 *          Conventions → Expression of Ideas), easy→hard within each block.
 *        • Math is a single stream ordered by ascending difficulty, with
 *          grid-ins (student-produced response) trailing the multiple-choice of
 *          the same tier — mirroring how Bluebook ramps a math module.
 *
 * Pure and I/O-free so it's unit-testable; the tRPC layer feeds it a pool and
 * uses the returned ordered ids to freeze an attempt.
 */

import { balanceDsat } from './module-balance.ts';
import {
  DSAT_DOMAIN_WEIGHTS,
  MATH_DOMAIN_ORDER,
  MATH_DOMAIN_WEIGHTS,
  RW_MODULE_DOMAIN_ORDER,
  type Section,
} from '../lib/dsat.ts';

/** The fields the ordering + balancing need from each candidate question. */
export interface PoolItem {
  id: string;
  domain: string | null;
  skill: string | null;
  difficulty: string | null;
  position: number | null;
  answer_format?: string | null;
}

export interface ExamModule {
  /** Question ids in the exact order they should be sat. */
  orderedIds: string[];
  /** How many were drawn from each domain (for a preview / summary). */
  plan: Record<string, number>;
  /** Total actually drawn — may be below the request if the pool ran short. */
  total: number;
  /** Notes about any compromise the balancer had to make. */
  notes: string[];
}

const DIFF_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
/** Unknown difficulty sorts as medium so it lands in the middle, not the ends. */
const diffRank = (d: string | null): number => (d && d in DIFF_RANK ? DIFF_RANK[d] : 1);

/**
 * Rank a Reading & Writing skill within its domain, in the order a real Bluebook
 * module walks them. Matched on normalized keywords, not exact strings, because
 * the bank holds many spellings of the same skill ("Central Ideas & Details",
 * "Text Structure and Purpose", "Form, Structure & Sense (…)", "Inference"). Any
 * skill that doesn't match sorts after the known ones, keeping the block intact.
 *
 *   Craft & Structure:   Words in Context → Text Structure & Purpose → Cross-Text
 *   Information & Ideas:  Central Ideas → Command of Evidence (Textual →
 *                         Quantitative) → Inferences
 *   Std. English Conv.:   Boundaries → Form, Structure & Sense
 *   Expression of Ideas:  Transitions → Rhetorical Synthesis
 */
export function rwSkillRank(domain: string | null, skill: string | null): number {
  const s = (skill ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const has = (kw: string) => s.includes(kw);

  switch (domain) {
    case 'craft_and_structure':
      if (has('words in context')) return 0;
      if (has('text structure')) return 1;
      if (has('cross')) return 2;
      return 3;
    case 'information_and_ideas':
      if (has('central idea')) return 0;
      if (has('command of evidence') && has('quantitative')) return 2;
      if (has('command of evidence') || has('textual evidence')) return 1;
      if (has('inference')) return 3;
      return 4;
    case 'standard_english_conventions':
      if (has('boundaries')) return 0;
      if (has('form') && has('structure')) return 1;
      return 2;
    case 'expression_of_ideas':
      if (has('transition')) return 0;
      if (has('rhetorical')) return 1;
      return 2;
    default:
      return 99;
  }
}
/** Grid-ins trail multiple-choice within a difficulty tier, as on the real exam. */
const formatRank = (f: string | null | undefined): number => (f === 'spr' ? 1 : 0);
const posRank = (p: number | null): number => (p ?? Number.POSITIVE_INFINITY);

/** Rank a value by its index in `order`; unlisted values sort last. */
function indexRanker(order: readonly string[]): (v: string | null) => number {
  const idx = new Map(order.map((v, i) => [v, i]));
  return (v) => (v != null && idx.has(v) ? idx.get(v)! : order.length);
}

/** Fisher–Yates — the per-domain draw is genuinely random, not sliced. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Lay a chosen set out in real-module order for its section. */
export function orderLikeExam(items: PoolItem[], section: Section): PoolItem[] {
  if (section === 'math') {
    const domainRank = indexRanker(MATH_DOMAIN_ORDER);
    return [...items].sort(
      (a, b) =>
        diffRank(a.difficulty) - diffRank(b.difficulty) ||
        formatRank(a.answer_format) - formatRank(b.answer_format) ||
        domainRank(a.domain) - domainRank(b.domain) ||
        posRank(a.position) - posRank(b.position),
    );
  }
  // Reading & Writing: fixed domain blocks (Reading domains first, then Writing).
  // Within a domain the real module groups by skill sub-type then runs
  // easiest→hardest — except Standard English Conventions, which College Board
  // sorts by difficulty only, with the grammar sub-types mixed together.
  const domainRank = indexRanker(RW_MODULE_DOMAIN_ORDER);
  return [...items].sort((a, b) => {
    const byDomain = domainRank(a.domain) - domainRank(b.domain);
    if (byDomain !== 0) return byDomain;
    // Same domain from here on.
    if (a.domain === 'standard_english_conventions') {
      return diffRank(a.difficulty) - diffRank(b.difficulty) || posRank(a.position) - posRank(b.position);
    }
    return (
      rwSkillRank(a.domain, a.skill) - rwSkillRank(b.domain, b.skill) ||
      diffRank(a.difficulty) - diffRank(b.difficulty) ||
      posRank(a.position) - posRank(b.position)
    );
  });
}

/**
 * Build one module of `count` questions from `pool`, balanced to the section's
 * official domain mix and ordered like the real exam.
 */
export function selectExamModule(pool: PoolItem[], section: Section, count: number): ExamModule {
  const weights = (section === 'math' ? MATH_DOMAIN_WEIGHTS : DSAT_DOMAIN_WEIGHTS) as Record<
    string,
    number
  >;

  const available: Record<string, number> = {};
  for (const q of pool) {
    const d = q.domain ?? 'unclassified';
    available[d] = (available[d] ?? 0) + 1;
  }

  const plan = balanceDsat(count, available, weights);

  // Group the pool by domain, then take the planned count from each (shuffled).
  const byDomain = new Map<string, PoolItem[]>();
  for (const q of pool) {
    const d = q.domain ?? 'unclassified';
    const list = byDomain.get(d);
    if (list) list.push(q);
    else byDomain.set(d, [q]);
  }

  const picked: PoolItem[] = [];
  for (const [domain, want] of Object.entries(plan.byDomain)) {
    picked.push(...shuffle(byDomain.get(domain) ?? []).slice(0, want));
  }

  return {
    orderedIds: orderLikeExam(picked, section).map((q) => q.id),
    plan: plan.byDomain,
    total: picked.length,
    notes: plan.notes,
  };
}
