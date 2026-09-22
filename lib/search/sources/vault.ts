import 'server-only';

import { createVaultClient } from '@/lib/vault/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';

/**
 * Vault notes, in the command palette.
 *
 * By title and by path, because a vault is organised by folders and half of
 * what somebody remembers about a note is where they put it. Titles now,
 * bodies later -- the difference is a full-text index rather than an ilike,
 * and it was decided that way on the feature.
 *
 * Never the body here for a second reason as well: a note body is the most
 * personal text in this application, and putting it through a like-match into
 * a dropdown is not the place to start reading it. That holds for the whole
 * list the palette now fetches too: titles and paths go to the browser, and
 * nothing anybody wrote does.
 */

const COLUMNS = 'id, title, path, updated_at';

type NoteRow = { id: string; title: string | null; path: string; updated_at: string | null };

/** A search, or -- with no query -- every note. */
type Read = SearchListContext & { query?: string };

/**
 * Each note once, newest first, no more than the caller asked for.
 *
 * The two searching reads each take `limit` rows of their own, so the cap and
 * the ordering are both applied again here over what they returned together.
 */
function newest(rows: NoteRow[], limit: number): NoteRow[] {
  const seen = new Set<string>();
  const unique: NoteRow[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }

  unique.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  return unique.slice(0, limit);
}

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createVaultClient();

  const search = (column: 'title' | 'path', pattern: string) =>
    supabase
      .from('notes')
      .select(COLUMNS)
      .ilike(column, pattern)
      .order('updated_at', { ascending: false })
      .limit(ctx.limit);

  const rows: NoteRow[] = [];

  if (ctx.query) {
    // One read per column rather than an `or` over both. PostgREST reads a
    // comma inside an `or` expression as the separator between its two sides,
    // so a search for a phrase with a comma in it sent a filter that does not
    // parse and the palette dropped the whole source. `.ilike()` sends the
    // pattern as its own parameter, where a comma is ordinary text.
    const pattern = `%${escapeLike(ctx.query)}%`;
    const [byTitle, byPath] = await Promise.all([search('title', pattern), search('path', pattern)]);

    if (byTitle.error) throw new Error(`notes by title: ${byTitle.error.message}`);
    if (byPath.error) throw new Error(`notes by path: ${byPath.error.message}`);

    rows.push(...((byTitle.data ?? []) as unknown as NoteRow[]));
    rows.push(...((byPath.data ?? []) as unknown as NoteRow[]));
  } else {
    const { data, error } = await supabase
      .from('notes')
      .select(COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(ctx.limit);

    if (error) throw new Error(`notes: ${error.message}`);

    rows.push(...((data ?? []) as unknown as NoteRow[]));
  }

  return newest(rows, ctx.limit).map((row) => {
    // A note with no frontmatter title is known by its filename, which is
    // what the vault itself shows.
    const name = row.title?.trim() || row.path.split('/').pop() || row.path;
    const folder = row.path.split('/').slice(0, -1).join('/');

    return {
      module: 'vault' as const,
      kind: 'note' as const,
      id: row.id,
      title: name,
      subtitle: folder ? `Note · ${folder}` : 'Note',
      // The path is half of how a note is remembered, so it is matched on
      // and worth carrying into the ranking.
      match: row.path,
      href: `/vault/n/${row.path.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
}

export const vaultSearchSource: SearchSource = {
  id: 'vault',
  module: 'vault',
  label: 'Vault',
  kinds: ['note'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};
