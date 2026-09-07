'use server';

/**
 * Saying "these are the same item", and taking it back.
 *
 * Stacking is derived by default (lib/inventory/item-groups.ts), so these
 * actions exist only for the two things a derivation cannot do: put together
 * what it kept apart, and hold out what it stacked. Everything here writes
 * `inventory_items.group_id` and nothing else moves, which is what makes all
 * three reversible — ungrouping hands the units straight back to the key.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { groupKeyFor, type GroupableItem } from '@/lib/share/grouping';
import type { ActionState } from '@/app/shopping/inventory/actions';

const SELECT = `
  id, name, short_name, fingerprint_loose, group_id, acquired_at,
  game_details ( bgg_id, needs_confirmation )
`;

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type UnitRow = {
  id: string;
  name: string;
  short_name: string | null;
  fingerprint_loose: string | null;
  group_id: string | null;
  acquired_at: string | null;
  game_details: unknown;
};

/**
 * Oldest first, then by id — the same total order stackUnits uses to pick a
 * stack's primary, so the copy that names the new group is the copy the list
 * and the page already treat as standing for the item.
 */
function byAge(a: UnitRow, b: UnitRow): number {
  const left = a.acquired_at ?? '';
  const right = b.acquired_at ?? '';
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  }
  return a.id.localeCompare(b.id);
}

function groupable(row: UnitRow): GroupableItem {
  const game = first(row.game_details as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    inventoryItemId: row.id,
    name: row.name,
    shortName: row.short_name,
    bggId: (game?.bgg_id as number | null) ?? null,
    needsConfirmation: Boolean(game?.needs_confirmation),
    isGame: Boolean(game),
    fingerprintLoose: row.fingerprint_loose,
  };
}

function idsFrom(formData: FormData): string[] {
  return formData
    .getAll('id')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);
}

/** Every page whose contents change when the stacking changes. */
function revalidateGrouping(ids: string[]): void {
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/sell');
  for (const id of ids) revalidatePath(`/shopping/inventory/${id}`);
}

const displayName = (row: UnitRow) => row.short_name?.trim() || row.name.trim();

/**
 * Put the selected copies under one item.
 *
 * If any of them is already in a group, that group absorbs the rest rather
 * than a second one appearing beside it — "add these to that item" is what
 * selecting a grouped copy alongside loose ones means.
 *
 * The new group claims the primary copy's derived key so later arrivals of the
 * same thing join it on their own. Claiming is best-effort: another group may
 * already hold that key, and a group with no key still works, it just stops
 * absorbing. Nothing about the copies themselves is rewritten, so ungrouping
 * puts everything back exactly as it was.
 */
export async function groupItemsTogether(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const ids = idsFrom(formData);
  if (ids.length < 2) return { error: 'Pick at least two copies to group.' };

  const { data } = await supabase
    .from('inventory_items')
    .select(SELECT)
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .in('id', ids);
  // Sorted rather than taken in whatever order the query returned them: the
  // first row names the group and donates its derived key, and that must not
  // change between two presses of the same button.
  const rows = ((data ?? []) as unknown as UnitRow[]).sort(byAge);
  if (rows.length < 2) return { error: 'Those copies could not be found.' };

  const existing = rows.find((row) => row.group_id)?.group_id ?? null;
  let groupId = existing;

  if (!groupId) {
    const primary = rows[0]!;
    const key = groupKeyFor(groupable(primary));

    const insert = async (groupKey: string | null) =>
      supabase
        .from('item_groups')
        .insert({ user_id: user.id, name: displayName(primary), group_key: groupKey })
        .select('id')
        .single();

    let { data: group, error } = await insert(key);
    // 23505: another group already stands for that key. Keep the group, drop
    // the claim — grouping by hand must not fail over an optimisation.
    if (error?.code === '23505') ({ data: group, error } = await insert(null));
    if (error || !group) return { error: error?.message ?? 'Could not make that group.' };
    groupId = group.id as string;
  }

  const { error } = await supabase
    .from('inventory_items')
    .update({ group_id: groupId })
    .eq('user_id', user.id)
    .in(
      'id',
      rows.map((row) => row.id),
    );
  if (error) return { error: error.message };

  revalidateGrouping(rows.map((row) => row.id));
  return { message: `${rows.length} copies grouped as one item.` };
}

/**
 * Hold one copy out of the stack it is in.
 *
 * It goes into a group of its own with no derived key, which is what makes the
 * split stick: with no key nothing is ever drawn back into it, and the copy
 * cannot re-stack with the siblings it was just taken from.
 */
export async function separateCopy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing copy.' };

  const { data } = await supabase
    .from('inventory_items')
    .select(SELECT)
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  const row = data as unknown as UnitRow | null;
  if (!row) return { error: 'That copy could not be found.' };

  const { data: group, error: groupError } = await supabase
    .from('item_groups')
    .insert({ user_id: user.id, name: displayName(row), group_key: null })
    .select('id')
    .single();
  if (groupError || !group) {
    return { error: groupError?.message ?? 'Could not separate that copy.' };
  }

  const { error } = await supabase
    .from('inventory_items')
    .update({ group_id: group.id })
    .eq('user_id', user.id)
    .eq('id', row.id);
  if (error) return { error: error.message };

  revalidateGrouping([row.id]);
  return { message: 'Separated. It is its own item now.' };
}

/**
 * Undo a grouping: the copies go back to stacking on their derived key.
 *
 * Deleting the row would do it too — `group_id` is `on delete set null` — but
 * clearing first means the copies are never briefly pointing at a group that
 * is on its way out.
 */
export async function ungroupItems(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const groupId = z.string().uuid().safeParse(formData.get('group_id'));
  if (!groupId.success) return { error: 'Missing group.' };

  // Ownership is checked here rather than trusted from the form: the update
  // below filters on user_id, but the delete needs the same guarantee.
  const { data: group } = await supabase
    .from('item_groups')
    .select('id')
    .eq('id', groupId.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!group) return { error: 'That group could not be found.' };

  const { data: members } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('group_id', group.id);
  const ids = (members ?? []).map((row) => row.id as string);

  const { error } = await supabase
    .from('inventory_items')
    .update({ group_id: null })
    .eq('user_id', user.id)
    .eq('group_id', group.id);
  if (error) return { error: error.message };

  await supabase.from('item_groups').delete().eq('id', group.id).eq('user_id', user.id);

  revalidateGrouping(ids);
  return { message: 'Ungrouped. These stack by their own details again.' };
}

/** Rename the item a stack of copies represents. */
export async function renameItemGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const groupId = z.string().uuid().safeParse(formData.get('group_id'));
  const name = String(formData.get('name') ?? '').trim();
  if (!groupId.success) return { error: 'Missing group.' };
  if (!name) return { error: 'Give the item a name.' };

  const { data: members } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('group_id', groupId.data);

  const { error } = await supabase
    .from('item_groups')
    .update({ name: name.slice(0, 200) })
    .eq('id', groupId.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidateGrouping((members ?? []).map((row) => row.id as string));
  return { message: 'Renamed.' };
}
