/** Presentation labels for DB enum values. */

const DOMAIN_LABELS: Record<string, string> = {
  // Reading & Writing
  information_and_ideas: 'Information & Ideas',
  craft_and_structure: 'Craft & Structure',
  expression_of_ideas: 'Expression of Ideas',
  standard_english_conventions: 'Standard English Conventions',
  // Math
  algebra: 'Algebra',
  advanced_math: 'Advanced Math',
  problem_solving_data_analysis: 'Problem-Solving & Data Analysis',
  geometry_trigonometry: 'Geometry & Trigonometry',
};

export function domainLabel(domain: string | null): string {
  if (!domain) return 'Unclassified';
  return DOMAIN_LABELS[domain] ?? domain;
}

/** First word of a domain, for compact badges. */
export function domainShort(domain: string | null): string {
  return domainLabel(domain).split(' ')[0];
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Coarse relative time: "2 days ago", "3 weeks ago".
 *
 * Deliberately low-resolution — for a created-at stamp, "3 weeks ago" is more
 * readable than a date, and the exact minute never matters.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const units: [limit: number, secs: number, name: string][] = [
    [60, 60, 'minute'],
    [24, 3600, 'hour'],
    [7, 86400, 'day'],
    [4.35, 604800, 'week'],
    [12, 2629800, 'month'],
    [Infinity, 31557600, 'year'],
  ];

  for (const [limit, secs, name] of units) {
    const value = Math.floor(seconds / secs);
    if (value < limit) {
      return `${value} ${name}${value === 1 ? '' : 's'} ago`;
    }
  }
  return '';
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Tone for an accuracy percentage, shared by bars and badges. */
export function accuracyTone(pct: number): 'green' | 'amber' | 'miss' {
  if (pct >= 75) return 'green';
  if (pct >= 60) return 'amber';
  return 'miss';
}
