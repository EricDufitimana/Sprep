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
  // Reading & Writing: domain blocks in module sequence, easy→hard within.
  const domainRank = indexRanker(RW_MODULE_DOMAIN_ORDER);
  return [...items].sort(
    (a, b) =>
      domainRank(a.domain) - domainRank(b.domain) ||
      diffRank(a.difficulty) - diffRank(b.difficulty) ||
      posRank(a.position) - posRank(b.position),
  );
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
