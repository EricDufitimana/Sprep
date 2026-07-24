/**
 * Fetch every row of a PostgREST query, one page at a time.
 *
 * The RLS-scoped Supabase client caps a single response at PostgREST's
 * `max-rows` (1000 by default), so any select whose result can exceed that
 * silently truncates — a counts or id-pool query then sees only a slice of the
 * table. `runPage` re-runs the same filtered, *ordered* query for each window;
 * a stable order (e.g. `.order('id')`) is required so pages don't overlap or
 * skip rows.
 */
export async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await runPage(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
