import type { SchemaClient } from '@/lib/ask/db';
import { slugifyCategoryName } from '@/lib/categories/slugify';
import { pickListGradient } from './gradients';

/**
 * The person's item lists and what is on them, written as Shopping's
 * settings and item pages and Dash's item_lists all write them (plan
 * #2473.4). Each takes the user explicitly, so it works the same on the
 * page's client (RLS) and on the connector's service role. The membership
 * writes take a list and items the caller has checked are theirs, and hand
 * back the membership rows they added or took away, whole, so Dash can keep
 * its Undo.
 */

type Row = Record<string, unknown>;

export const LIST_TAKEN = 'That list name is already used. Try another.';

/** Make a list, coloured with the next gradient they have least of. The name comes in trimmed, 2 to 40 characters. */
export async function makeItemList(
  supabase: SchemaClient,
  opts: { userId: string; name: string },
): Promise<{ list: Row; error?: undefined } | { list?: undefined; error: string }> {
  const slug = slugifyCategoryName(opts.name);
  if (!slug) return { error: 'Use letters or numbers in the list name.' };
  const { data: lists, error: readError } = await supabase.from('item_lists').select('slug, color').eq('user_id', opts.userId);
  if (readError) return { error: readError.message };
  const theirs = (lists ?? []) as Row[];
  if (theirs.some((row) => row.slug === slug)) return { error: LIST_TAKEN };
  const color = pickListGradient(theirs.map((row) => row.color as string | null));
  const { data, error } = await supabase
    .from('item_lists')
    .insert({ user_id: opts.userId, name: opts.name, slug, color })
    .select('*')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create that list.' };
  return { list: data as Row };
}

/** Rename one of their lists. Its slug stays, as it always has. */
export async function renameList(
  supabase: SchemaClient,
  opts: { userId: string; id: string; name: string },
): Promise<{ list: Row; error?: undefined } | { list?: undefined; error: string }> {
  const { data, error } = await supabase
    .from('item_lists')
    .update({ name: opts.name })
    .eq('id', opts.id)
    .eq('user_id', opts.userId)
    .select('*')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'That list could not be found.' };
  return { list: data as Row };
}

/** Put items on a list; the ones on it already stay as they are. */
export async function addToList(
  supabase: SchemaClient,
  opts: { listId: string; itemIds: readonly string[] },
): Promise<{ added: Row[]; error?: undefined } | { added?: undefined; error: string }> {
  if (opts.itemIds.length === 0) return { added: [] };
  const { data: on, error: readError } = await supabase
    .from('inventory_item_lists')
    .select('inventory_item_id')
    .eq('list_id', opts.listId)
    .in('inventory_item_id', [...opts.itemIds]);
  if (readError) return { error: readError.message };
  const there = new Set(((on ?? []) as Row[]).map((row) => row.inventory_item_id as string));
  const joining = [...new Set(opts.itemIds)].filter((id) => !there.has(id));
  if (joining.length === 0) return { added: [] };
  const { data, error } = await supabase
    .from('inventory_item_lists')
    .insert(joining.map((id) => ({ inventory_item_id: id, list_id: opts.listId })))
    .select('*');
  if (error) return { error: error.message };
  return { added: (data ?? []) as Row[] };
}

/** Take items off a list. */
export async function removeFromList(
  supabase: SchemaClient,
  opts: { listId: string; itemIds: readonly string[] },
): Promise<{ removed: Row[]; error?: undefined } | { removed?: undefined; error: string }> {
  if (opts.itemIds.length === 0) return { removed: [] };
  const { data: on, error: readError } = await supabase
    .from('inventory_item_lists')
    .select('*')
    .eq('list_id', opts.listId)
    .in('inventory_item_id', [...opts.itemIds]);
  if (readError) return { error: readError.message };
  const removed = (on ?? []) as Row[];
  if (removed.length === 0) return { removed };
  const { error } = await supabase
    .from('inventory_item_lists')
    .delete()
    .eq('list_id', opts.listId)
    .in(
      'id',
      removed.map((row) => row.id as string),
    );
  if (error) return { error: error.message };
  return { removed };
}

/** Put one item on exactly these lists of theirs, taking it off the rest, as the item page's checklist does. */
export async function setItemLists(
  supabase: SchemaClient,
  opts: { userId: string; itemId: string; listIds: readonly string[] },
): Promise<{ error?: string }> {
  const { data: lists, error: listsError } = await supabase.from('item_lists').select('id').eq('user_id', opts.userId);
  if (listsError) return { error: listsError.message };
  const theirs = ((lists ?? []) as Row[]).map((row) => row.id as string);
  const wanted = new Set(opts.listIds.filter((id) => theirs.includes(id)));
  for (const listId of theirs) {
    const result = wanted.has(listId)
      ? await addToList(supabase, { listId, itemIds: [opts.itemId] })
      : await removeFromList(supabase, { listId, itemIds: [opts.itemId] });
    if (result.error !== undefined) return { error: result.error };
  }
  return {};
}
