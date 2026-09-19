import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';

/**
 * Todos, in the command palette.
 *
 * A task is the one thing in this application with no page of its own -- it is
 * a row on a list, and giving it a route to satisfy a search would be building
 * a page nobody asked for. So a hit lands on /todo/all with the task scrolled
 * to and briefly highlighted, which is where somebody would have gone looking
 * for it anyway.
 *
 * Open tasks rank above done ones, because "find that thing I still have to
 * do" is what the box is for, and an archive of finished work is where the
 * same words go to be unhelpful.
 */

/** A search, or -- with no query -- every task. */
type Read = SearchListContext & { query?: string };

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createTodoClient();

  let tasks = supabase.from('tasks').select('id, title, status, due_on');
  if (ctx.query) tasks = tasks.ilike('title', `%${escapeLike(ctx.query)}%`);

  const { data, error } = await tasks
    // Open first, then most recently touched: the two together are what
    // makes the first hit usually the right one.
    .order('status', { ascending: true })
    .order('updated_at', { ascending: false })
    .limit(ctx.limit);

  if (error) throw new Error(`tasks: ${error.message}`);

  const rows = (data ?? []) as {
    id: string;
    title: string;
    status: string;
    due_on: string | null;
  }[];

  // `status` sorts alphabetically in the database -- done before open --
  // which is the wrong way round, so the ordering that matters is done here.
  const ranked = [...rows].sort((a, b) => {
    const openness = Number(a.status !== 'open') - Number(b.status !== 'open');
    return openness;
  });

  return ranked.map((row) => ({
    module: 'todo' as const,
    kind: 'task' as const,
    id: row.id,
    title: row.title,
    subtitle:
      row.status === 'open'
        ? row.due_on
          ? `Todo · due ${row.due_on}`
          : 'Todo'
        : `Todo · ${row.status}`,
    // No page of its own: the list, with this one focused.
    href: `/todo/all?status=all&focus=${row.id}`,
  }));
}

export const todoSearchSource: SearchSource = {
  id: 'todo',
  module: 'todo',
  label: 'Todo',
  kinds: ['task'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};
