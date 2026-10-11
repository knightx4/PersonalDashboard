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
import {
  displayName,
  groupUnits,
  UNIT_SELECT as SELECT,
  type UnitRow,
} from '@/lib/inventory/group-units';
import type { ActionState } from '@/app/shopping/inventory/actions';

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

/**
 * Put the selected copies under one item (groupUnits in
 * lib/inventory/group-units.ts, which Dash's change_items write shares).
 */
// latency: pending
export async function groupItemsTogether(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const grouped = await groupUnits(supabase, user.id, idsFrom(formData));
  if (!grouped.ok) return { error: grouped.error };

  revalidateGrouping(grouped.ids);
  return { message: `${grouped.ids.length} copies grouped as one item.` };
}

/**
 * Hold one copy out of the stack it is in.
 *
 * It goes into a group of its own with no derived key, which is what makes the
 * split stick: with no key nothing is ever drawn back into it, and the copy
 * cannot re-stack with the siblings it was just taken from.
 */
// latency: pending
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
// latency: pending
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
// latency: pending
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
