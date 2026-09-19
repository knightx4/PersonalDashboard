import 'server-only';

import { createLearnClient } from '@/lib/learn/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';

/**
 * The reading queue, in the command palette.
 *
 * Readings and tracks. A reading is found by the subject you wrote down or by
 * the title of the source attached to it, which are two different strings and
 * both of them are things somebody would type -- "the Hayek essay" and "how
 * prices coordinate" are the same row reached from opposite ends.
 */

type ReadingRow = {
  id: string;
  title: string | null;
  status: string;
  sources:
    | { title: string; author: string | null }
    | { title: string; author: string | null }[]
    | null;
};

/** A search, or -- with no query -- everything. */
type Read = SearchListContext & { query?: string };

function readingHit(row: ReadingRow): SearchHit {
  const source = Array.isArray(row.sources) ? row.sources[0] : row.sources;
  return {
    module: 'learn',
    kind: 'reading',
    id: row.id,
    // A reading whose subject came from its source has a null title, so the
    // source's title stands in -- the same fallback lib/learn/tracks/load.ts
    // already makes.
    title: source?.title ?? row.title ?? 'Untitled',
    subtitle: source?.author ? `Reading · ${source.author}` : `Reading · ${row.status}`,
    match: row.title ?? undefined,
    href: `/learn/r/${row.id}`,
  };
}

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createLearnClient();
  const pattern = ctx.query ? `%${escapeLike(ctx.query)}%` : null;

  let readingsRead = supabase.from('readings').select('id, title, status, sources(title, author)');
  if (pattern) readingsRead = readingsRead.ilike('title', pattern);

  let tracksRead = supabase.from('tracks').select('id, title, question');
  if (pattern) tracksRead = tracksRead.ilike('title', pattern);

  const [{ data: readings, error: readingError }, { data: tracks, error: trackError }] =
    await Promise.all([
      readingsRead.order('updated_at', { ascending: false }).limit(ctx.limit),
      tracksRead.order('updated_at', { ascending: false }).limit(ctx.limit),
    ]);

  if (readingError) throw new Error(`readings: ${readingError.message}`);
  if (trackError) throw new Error(`tracks: ${trackError.message}`);

  const rows = [...((readings ?? []) as unknown as ReadingRow[])];

  // A reading is looked for by its source's title as well, which the read
  // above cannot match on. With no query there is nothing to match, so that
  // second read is a search-only cost.
  if (pattern) {
    const { data: bySource, error: sourceError } = await supabase
      .from('readings')
      .select('id, title, status, sources!inner(title, author)')
      .ilike('sources.title', pattern)
      .order('updated_at', { ascending: false })
      .limit(ctx.limit);

    if (sourceError) throw new Error(`readings by source: ${sourceError.message}`);

    rows.push(...((bySource ?? []) as unknown as ReadingRow[]));
  }

  const seen = new Set<string>();
  const hits: SearchHit[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    hits.push(readingHit(row));
  }

  for (const row of (tracks ?? []) as { id: string; title: string; question: string | null }[]) {
    hits.push({
      module: 'learn',
      kind: 'track',
      id: row.id,
      title: row.title,
      subtitle: 'Track',
      href: `/learn/t/${row.id}`,
    });
  }

  return hits;
}

export const learnSearchSource: SearchSource = {
  id: 'learn',
  module: 'learn',
  label: 'Learn',
  kinds: ['reading', 'track'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};
