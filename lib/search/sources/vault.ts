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

/** A search, or -- with no query -- every note. */
type Read = SearchListContext & { query?: string };

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createVaultClient();

  let notes = supabase.from('notes').select('id, title, path, updated_at');
  if (ctx.query) {
    const pattern = `%${escapeLike(ctx.query)}%`;
    notes = notes.or(`title.ilike.${pattern},path.ilike.${pattern}`);
  }

  const { data, error } = await notes.order('updated_at', { ascending: false }).limit(ctx.limit);

  if (error) throw new Error(`notes: ${error.message}`);

  return ((data ?? []) as { id: string; title: string | null; path: string }[]).map((row) => {
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
