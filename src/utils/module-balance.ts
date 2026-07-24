/**
 * Decide how many questions to draw from each domain for a composed module.
 *
 * Pure and I/O-free, so it's fully unit-testable. Two callers: DSAT-standard
 * modules (weighted by the official domain mix) and custom modules (explicit
 * per-domain counts, still capped at what's available).
 *
 * The hard part is that available content rarely matches the ideal mix — a
 * user's banks might be all one domain. The balancer never asks for more than
 * exists, and when a weighted target can't be met it backfills the shortfall
 * from domains that still have capacity, so the module still reaches its total
 * length. It reports whatever it couldn't honour rather than silently shrinking.
 */

export type Domain = string;

export interface BalanceResult {
  /** Chosen count per domain. Only domains with a positive count appear. */
  byDomain: Record<Domain, number>;
  /** Total actually allocated — may be below `requestedTotal` if content ran out. */
  total: number;
  /** True when the allocation matched the ideal weighted split exactly. */
  balanced: boolean;
  /** Human-readable notes about compromises made (empty when none). */
  notes: string[];
}

/**
 * Hamilton's largest-remainder method: split `total` across `weights` so the
 * parts are whole numbers that sum to exactly `total`, with no rounding drift.
 */
export function largestRemainder(total: number, weights: Record<Domain, number>): Record<Domain, number> {
  const domains = Object.keys(weights);
  const sumW = domains.reduce((s, d) => s + Math.max(0, weights[d]), 0);
  if (sumW <= 0 || total <= 0) return Object.fromEntries(domains.map((d) => [d, 0]));

  const exact = domains.map((d) => ({ d, ideal: (total * Math.max(0, weights[d])) / sumW }));
  const floors = exact.map((e) => ({ ...e, floor: Math.floor(e.ideal), rem: e.ideal - Math.floor(e.ideal) }));

  let allocated = floors.reduce((s, e) => s + e.floor, 0);
  // Hand out the leftover units to the largest fractional remainders.
  const order = [...floors].sort((a, b) => b.rem - a.rem);
  const out: Record<Domain, number> = Object.fromEntries(floors.map((e) => [e.d, e.floor]));
  let i = 0;
  while (allocated < total && order.length > 0) {
    out[order[i % order.length].d] += 1;
    allocated += 1;
    i += 1;
  }
  return out;
}

/**
 * DSAT-standard allocation: weighted target, capped at availability, with the
 * shortfall backfilled across domains that still have room.
 */
export function balanceDsat(
  requestedTotal: number,
  available: Record<Domain, number>,
  weights: Record<Domain, number>,
): BalanceResult {
  const domains = Object.keys(weights);
  const notes: string[] = [];

  // Can't draw more than exists in total, regardless of the mix.
  const grandAvailable = domains.reduce((s, d) => s + (available[d] ?? 0), 0);
  const total = Math.min(requestedTotal, grandAvailable);
  if (total < requestedTotal) {
    notes.push(`Only ${grandAvailable} questions available — the module is ${total}, not ${requestedTotal}.`);
  }

  const ideal = largestRemainder(total, weights);
  const chosen: Record<Domain, number> = {};
  let shortfall = 0;

  // First pass: take the ideal, capped at what each domain has.
  for (const d of domains) {
    const want = ideal[d] ?? 0;
    const have = available[d] ?? 0;
    chosen[d] = Math.min(want, have);
    shortfall += want - chosen[d];
  }

  // Backfill the shortfall from domains with leftover capacity, weighted so the
  // fill still leans toward the intended mix.
  if (shortfall > 0) {
    const shortDomains = domains.filter((d) => (available[d] ?? 0) > 0);
    let remaining = shortfall;
    // Round-robin by descending weight keeps the backfill proportional.
    const order = [...shortDomains].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
    let guard = 0;
    while (remaining > 0 && guard < 10000) {
      let progressed = false;
      for (const d of order) {
        if (remaining <= 0) break;
        if (chosen[d] < (available[d] ?? 0)) {
          chosen[d] += 1;
          remaining -= 1;
          progressed = true;
        }
      }
      if (!progressed) break; // every domain is capped
      guard += 1;
    }
    if (remaining === 0) {
      notes.push('Some domains were short, so the mix was rebalanced toward available content.');
    }
  }

  const finalTotal = domains.reduce((s, d) => s + chosen[d], 0);
  const balanced = domains.every((d) => chosen[d] === (ideal[d] ?? 0));

  return {
    byDomain: pruneZero(chosen),
    total: finalTotal,
    balanced,
    notes,
  };
}

/**
 * Custom allocation: the user names an exact count per domain. Each is capped
 * at availability, and any shortfall is reported per domain rather than
 * backfilled — a custom request is taken literally.
 */
export function balanceCustom(
  requested: Record<Domain, number>,
  available: Record<Domain, number>,
  domainLabel: (d: Domain) => string = (d) => d,
): BalanceResult {
  const notes: string[] = [];
  const chosen: Record<Domain, number> = {};

  for (const d of Object.keys(requested)) {
    const want = Math.max(0, Math.floor(requested[d] ?? 0));
    const have = available[d] ?? 0;
    chosen[d] = Math.min(want, have);
    if (want > have) {
      notes.push(`${domainLabel(d)}: asked for ${want}, only ${have} available.`);
    }
  }

  const total = Object.values(chosen).reduce((s, n) => s + n, 0);
  return { byDomain: pruneZero(chosen), total, balanced: notes.length === 0, notes };
}

function pruneZero(counts: Record<Domain, number>): Record<Domain, number> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}
