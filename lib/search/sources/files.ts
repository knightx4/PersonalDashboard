import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { fileHref } from '@/lib/files/files';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';

/**
 * Files, in the command palette (note f02c0850): what Dash wrote for a goal
 * and what you gave it, read on /goals/files. Matched by title, newest first,
 * through the session client so RLS decides whose. Files sit under Goals, so
 * the hit is filed there and goes when Goals is switched off.
 */

type Read = SearchListContext & { query?: string };

type FileRow = { id: string; title: string; made_by: string };

async function read(ctx: Read): Promise<SearchHit[]> {
  const core = await createCoreClient();
  let files = core.from('files').select('id, title, made_by').is('archived_at', null);
  if (ctx.query) files = files.ilike('title', `%${escapeLike(ctx.query)}%`);
  const { data, error } = await files.order('updated_at', { ascending: false }).limit(ctx.limit);
  if (error) throw new Error(`files: ${error.message}`);

  return ((data ?? []) as FileRow[]).map((row) => ({
    module: 'goals' as const,
    kind: 'file' as const,
    id: row.id,
    ref: `core.files:${row.id}`,
    title: row.title,
    subtitle: row.made_by === 'you' ? 'File · yours' : 'File · by Dash',
    href: fileHref(row.id),
  }));
}

export const filesSearchSource: SearchSource = {
  id: 'files',
  module: 'goals',
  label: 'Files',
  kinds: ['file'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};
