import 'server-only';

import { createVaultClient } from '@/lib/vault/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

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

/** A search, or -- with no query -- every note. */
type Read = SearchListContext & { query?: string };

type NoteRow = { id: string; title: string | null; path: string };

/**
 * The newest notes, optionally narrowed to one column matching a pattern.
 *
 * One column per read, because the two columns together used to be an `or`
 * expression and a comma in what somebody typed reads as the separator
 * between its conditions. `.ilike()` sends the pattern as its own parameter,
 * where a comma is ordinary text. The limit applies to each read rather than
 * to the pair.
 */
async function notes(
  supabase: VaultSupabaseClient,
  ctx: Read,
  match?: { column: 'title' | 'path'; pattern: string },
): Promise<NoteRow[]> {
  let read = supabase.from('notes').select('id, title, path, updated_at');
  if (match) read = read.ilike(match.column, match.pattern);

  const { data, error } = await read.order('updated_at', { ascending: false }).limit(ctx.limit);

  if (error) throw new Error(`notes: ${error.message}`);

  return (data ?? []) as NoteRow[];
}

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createVaultClient();

  let rows: NoteRow[];
  if (ctx.query) {
    const pattern = `%${escapeLike(ctx.query)}%`;
    const [byTitle, byPath] = await Promise.all([
      notes(supabase, ctx, { column: 'title', pattern }),
      notes(supabase, ctx, { column: 'path', pattern }),
    ]);
    // A note whose title and path both match is one note.
    const seen = new Set<string>();
    rows = [...byTitle, ...byPath].filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  } else {
    rows = await notes(supabase, ctx);
  }

  return rows.map((row) => {
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
