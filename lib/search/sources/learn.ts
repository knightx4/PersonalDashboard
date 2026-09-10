import 'server-only';

import { createLearnClient } from '@/lib/learn/auth/server';
import type { SearchHit, SearchSource } from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';

/**
 * The reading queue, in the command palette.
 *
 * Readings and tracks. A reading is found by the subject you wrote down or by
 * the title of the source attached to it, which are two different strings and
 * both of them are things somebody would type -- "the Hayek essay" and "how
 * prices coordinate" are the same row reached from opposite ends.
 */
export const learnSearchSource: SearchSource = {
  id: 'learn',
  module: 'learn',
  label: 'Learn',
  kinds: ['reading', 'track'],

  async find(ctx): Promise<SearchHit[]> {
    const supabase = await createLearnClient();
    const pattern = `%${escapeLike(ctx.query)}%`;

    const [{ data: readings, error: readingError }, { data: tracks, error: trackError }] =
      await Promise.all([
        supabase
          .from('readings')
          .select('id, title, status, sources(title, author)')
          .ilike('title', pattern)
          .order('updated_at', { ascending: false })
          .limit(ctx.limit),
        supabase
          .from('tracks')
          .select('id, title, question')
          .ilike('title', pattern)
          .order('updated_at', { ascending: false })
          .limit(ctx.limit),
      ]);

    if (readingError) throw new Error(`readings: ${readingError.message}`);
    if (trackError) throw new Error(`tracks: ${trackError.message}`);

    // A reading whose subject came from its source has a null title, so the
    // source's title is looked up in the same read rather than in a second
    // pass -- the same fallback lib/learn/tracks/load.ts already makes.
    const { data: bySource, error: sourceError } = await supabase
      .from('readings')
      .select('id, title, status, sources!inner(title, author)')
      .ilike('sources.title', pattern)
      .order('updated_at', { ascending: false })
      .limit(ctx.limit);

    if (sourceError) throw new Error(`readings by source: ${sourceError.message}`);

    type ReadingRow = {
      id: string;
      title: string | null;
      status: string;
      sources: { title: string; author: string | null } | { title: string; author: string | null }[] | null;
    };

    const seen = new Set<string>();
    const hits: SearchHit[] = [];

    for (const row of [...((readings ?? []) as unknown as ReadingRow[]), ...((bySource ?? []) as unknown as ReadingRow[])]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);

      const source = Array.isArray(row.sources) ? row.sources[0] : row.sources;
      hits.push({
        module: 'learn',
        kind: 'reading',
        id: row.id,
        title: source?.title ?? row.title ?? 'Untitled',
        subtitle: source?.author ? `Reading · ${source.author}` : `Reading · ${row.status}`,
        match: row.title ?? undefined,
        href: `/learn/r/${row.id}`,
      });
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
  },
};
