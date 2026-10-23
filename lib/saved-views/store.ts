import 'server-only';

import { currentQuery, type ListSearchParams } from '@/lib/list-display';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Arrangements somebody saved under a name, kept on the account.
 *
 * A view is the whole query string of a list: its filters and its search as
 * well as its sort, its grouping and its hidden columns. Reopening the
 * arrangement and losing the filter would be the wrong rows in the right
 * order, so everything the page reads goes in.
 *
 * Views belong to one list. The `list` is its pathname, which is also where
 * reopening one points.
 */

export type SavedView = {
  id: string;
  list: string;
  name: string;
  /** The query string, without the leading '?'. Empty for the bare list. */
  query: string;
  isDefault: boolean;
};

type Row = { id: string; list: string; name: string; query: string; is_default: boolean };

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

function toView(row: Row): SavedView {
  return {
    id: row.id,
    list: row.list,
    name: row.name,
    query: row.query,
    isDefault: row.is_default,
  };
}

/** The views saved on one list, by name. */
export async function savedViewsFor(
  supabase: CoreSupabaseClient,
  list: string,
): Promise<SavedView[]> {
  const { data, error } = await supabase
    .from('saved_views')
    .select('id, list, name, query, is_default')
    .eq('list', list)
    .order('name');

  if (error) throw fail('Reading your saved views', error);
  return ((data ?? []) as Row[]).map(toView);
}

/**
 * The saved view on a list that a name would replace, if there is one.
 *
 * Names are compared without case, the same way the unique index on
 * `lower(name)` compares them: "Recent" and "recent" are one name to the
 * person typing them.
 */
export function viewNamed<T extends { name: string }>(
  views: readonly T[],
  name: string,
): T | null {
  const wanted = name.toLowerCase();
  return views.find((view) => view.name.toLowerCase() === wanted) ?? null;
}

/**
 * Save the arrangement as it stands.
 *
 * Saving under a name already on this list replaces that view rather than
 * making a second one with the same name. This is a lookup and then an update
 * or an insert rather than an upsert: the unique index is on `lower(name)`,
 * and PostgREST's `onConflict` can only name plain columns, so an upsert has
 * no constraint to land on and Postgres refuses it.
 */
export async function saveView(
  supabase: CoreSupabaseClient,
  userId: string,
  view: { list: string; name: string; query: string },
): Promise<void> {
  const { data, error: readError } = await supabase
    .from('saved_views')
    .select('id, name')
    .eq('user_id', userId)
    .eq('list', view.list);
  if (readError) throw fail('Saving the view', readError);

  const existing = viewNamed((data ?? []) as { id: string; name: string }[], view.name);
  const { error } = existing
    ? await supabase
        .from('saved_views')
        .update({ name: view.name, query: view.query })
        .eq('id', existing.id)
    : await supabase.from('saved_views').insert({
        user_id: userId,
        list: view.list,
        name: view.name,
        query: view.query,
      });

  if (error) throw fail('Saving the view', error);
}

export async function renameView(
  supabase: CoreSupabaseClient,
  viewId: string,
  name: string,
): Promise<void> {
  const { error } = await supabase.from('saved_views').update({ name }).eq('id', viewId);
  if (error) throw fail('Renaming the view', error);
}

export async function deleteView(
  supabase: CoreSupabaseClient,
  viewId: string,
): Promise<void> {
  const { error } = await supabase.from('saved_views').delete().eq('id', viewId);
  if (error) throw fail('Deleting the view', error);
}

/**
 * Make one view the one this list opens on, or take the mark off it.
 *
 * The old default is cleared first, because the database allows one per list
 * and would otherwise refuse the second write rather than the wrong one.
 */
export async function setDefaultView(
  supabase: CoreSupabaseClient,
  list: string,
  viewId: string | null,
): Promise<void> {
  const { error: cleared } = await supabase
    .from('saved_views')
    .update({ is_default: false })
    .eq('list', list)
    .eq('is_default', true);
  if (cleared) throw fail('Clearing the default view', cleared);

  if (!viewId) return;

  const { error } = await supabase
    .from('saved_views')
    .update({ is_default: true })
    .eq('id', viewId);
  if (error) throw fail('Setting the default view', error);
}


/**
 * Where to send somebody who opened a list with nothing asked for and has a
 * view marked as the one it opens on.
 *
 * Only on a bare URL. A link with any parameter in it is somebody asking for
 * something specific, and redirecting that to a saved view would make every
 * shared link open the wrong rows.
 */
export function defaultViewHref(
  views: readonly SavedView[],
  params: ListSearchParams,
): string | null {
  if (currentQuery(params) !== '') return null;
  const preferred = views.find((view) => view.isDefault && view.query !== '');
  return preferred ? `${preferred.list}?${preferred.query}` : null;
}
