/** PostgREST returns at most this many rows per request, so longer reads page. */
const PAGE = 1000;

/**
 * Every row of a read, a page at a time. `page` runs the read for one range
 * of rows; the loop stops at the first page that comes back short.
 */
export async function readAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}
