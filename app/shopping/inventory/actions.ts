'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  DISPOSAL_METHODS,
  type DisposalMethod,
} from '@/lib/inventory/status-actions';
import { parseDollarsToCents, todayInTimezone } from '@/lib/money';
import { describeItem } from '@/lib/inventory/item-writes';
import {
  attributeKey,
  mergeAttributeValues,
  parseAttributeValues,
  type AttributeValues,
} from '@/lib/inventory/attributes';
import { addToList, makeItemList, removeFromList, setItemLists } from '@/lib/lists/write';
import { disposeUnits, setUnitsFlag } from '@/lib/inventory/unit-changes';
import { markReturned } from '@/lib/returns/mark';

export interface ActionState {
  error?: string;
  message?: string;
}

async function userTimezone(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return data?.timezone ?? 'UTC';
}

/**
 * Save everything on the item's Details panel in one submit.
 *
 * Name, variant, category and notes used to be a separate "Edit" card from the
 * per-category detail fields, which meant two panels, two Save buttons, and no
 * way to tell which one you had actually pressed. They are one form now, so
 * this action carries the `attr_<key>` fields as well as the core columns.
 */
// latency: pending
export async function updateInventoryItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1, 'Name is required.'),
      variant: z.string().trim().optional(),
      categoryId: z
        .string()
        .uuid()
        .optional()
        .or(z.literal('').transform(() => undefined)),
      notes: z.string().optional(),
    })
    .safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
      variant: String(formData.get('variant') ?? ''),
      categoryId: String(formData.get('category_id') ?? ''),
      notes: String(formData.get('notes') ?? ''),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const submitted: AttributeValues = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith('attr_') || typeof value !== 'string') continue;
    const key = attributeKey(name.slice('attr_'.length));
    if (key) submitted[key] = value;
  }

  // One-off field added from the item itself, without touching the template:
  // the shape of a single object is not always the shape of its category.
  const newLabel = String(formData.get('new_label') ?? '').trim();
  const newValue = String(formData.get('new_value') ?? '').trim();
  if (newLabel && newValue) {
    const key = attributeKey(newLabel);
    if (!key) return { error: 'That field name has no letters or numbers in it.' };
    submitted[key] = newValue;
  }

  // Read-then-merge rather than replace: a value whose field the template has
  // since dropped is still the item's, and is not in this submit to defend it.
  const { data: current } = await supabase
    .from('inventory_items')
    .select('attributes')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!current) return { error: 'That item could not be found.' };

  // Everything on this form describes the item, not the box: a name, a
  // category and a template field are as true of the second copy of Acquire as
  // of the first. So the save reaches every copy in the stack (describeItem).
  // What genuinely differs between copies -- when it was bought, what it cost,
  // whether this one is on the sell page -- is edited elsewhere and is never
  // touched here.
  const saved = await describeItem(supabase, {
    userId: user.id,
    itemId: parsed.data.id,
    values: {
      name: parsed.data.name,
      variant: parsed.data.variant || null,
      category_id: parsed.data.categoryId ?? null,
      notes: parsed.data.notes ?? null,
      attributes: mergeAttributeValues(parseAttributeValues(current.attributes), submitted),
    },
  });
  if (!saved.ok) return { error: saved.error };
  const ids = saved.ids;

  revalidatePath('/shopping/inventory');
  for (const id of ids) revalidatePath(`/shopping/inventory/${id}`);
  return {
    message: ids.length > 1 ? `Saved to all ${ids.length} copies.` : 'Saved.',
  };
}

// latency: pending
export async function disposeInventoryItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const method = String(formData.get('disposal_method') ?? '') as DisposalMethod;
  if (!DISPOSAL_METHODS.includes(method)) {
    return { error: 'Pick how you got rid of it.' };
  }

  let proceedsCents = 0;
  try {
    proceedsCents = parseDollarsToCents(String(formData.get('disposal_proceeds') ?? ''));
  } catch {
    return { error: 'Proceeds must be a dollar amount like 12.99.' };
  }
  if (proceedsCents < 0) return { error: 'Proceeds cannot be negative.' };

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const timezone = await userTimezone(supabase, user.id);
  const disposed = await disposeUnits(supabase, {
    userId: user.id,
    ids: [id.data],
    method,
    proceedsCents,
    today: todayInTimezone(timezone),
  });
  if (!disposed.ok) return { error: disposed.error };
  const status = disposed.values.status;

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${id.data}`);
  revalidatePath('/shopping/orders');
  if (status === 'sold') return { message: 'Marked as sold.' };
  if (status === 'gifted') return { message: 'Marked as gifted.' };
  return { message: 'Marked as disposed.' };
}

/**
 * Mark returned by inserting a refunded `returns` row.
 *
 * Never writes inventory_items.status = 'returned' — the trigger-owned
 * sync_order_state() function does that from the return.
 */
// latency: pending
export async function markInventoryReturned(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  let refundCents: number;
  try {
    const raw = String(formData.get('refund_amount') ?? '').trim();
    refundCents = raw === '' ? -1 : parseDollarsToCents(raw);
  } catch {
    return { error: 'Refund amount must be a dollar amount like 12.99.' };
  }
  if (refundCents < -1 || (refundCents < 0 && refundCents !== -1)) {
    return { error: 'Refund amount cannot be negative.' };
  }

  const timezone = await userTimezone(supabase, user.id);
  const today = todayInTimezone(timezone);
  const marked = await markReturned(supabase, user.id, id.data, today, refundCents === -1 ? undefined : refundCents);
  if (!marked.ok) return { error: marked.error };

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${id.data}`);
  revalidatePath('/shopping/orders');
  revalidatePath(`/shopping/orders/${marked.orderId}`);
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/dashboard');
  return { message: 'Marked as returned.' };
}

/** Replace list memberships for one inventory item with the submitted checklist. */
// latency: pending
export async function updateInventoryItemLists(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const itemId = z.string().uuid().safeParse(formData.get('id'));
  if (!itemId.success) return { error: 'Missing item.' };

  const selected = formData
    .getAll('list_id')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', itemId.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'That item could not be found.' };

  const set = await setItemLists(supabase, { userId: user.id, itemId: item.id, listIds: selected });
  if (set.error) return { error: set.error };

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: 'Lists updated.' };
}

/** Create a list from an inventory item page and add this item to it. */
// latency: pending
export async function createItemListAndAssign(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const itemId = z.string().uuid().safeParse(formData.get('id'));
  if (!itemId.success) return { error: 'Missing item.' };

  const nameParsed = z
    .string()
    .trim()
    .min(2, 'Name needs at least 2 characters.')
    .max(40)
    .safeParse(formData.get('name'));
  if (!nameParsed.success) {
    return { error: nameParsed.error.issues[0]?.message ?? 'Enter a list name.' };
  }

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', itemId.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'That item could not be found.' };

  const made = await makeItemList(supabase, { userId: user.id, name: nameParsed.data });
  if (made.error !== undefined) return { error: made.error };

  const joined = await addToList(supabase, { listId: made.list.id as string, itemIds: [item.id] });
  if (joined.error !== undefined) return { error: joined.error };

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: `Added to “${nameParsed.data}”.` };
}

/** One-click dispose from a list row (defaults to trashed). */
// latency: pending
export async function quickDisposeInventoryItem(formData: FormData): Promise<void> {
  const next = new FormData();
  next.set('id', String(formData.get('id') ?? ''));
  next.set('disposal_method', String(formData.get('disposal_method') ?? 'trashed'));
  next.set('disposal_proceeds', String(formData.get('disposal_proceeds') ?? ''));
  const result = await disposeInventoryItem({}, next);
  if (result.error) throw new Error(result.error);
}

/** Add or remove one list membership without replacing the rest. */
// latency: pending -- should be optimistic: a checkbox that waits for the round trip
export async function toggleInventoryItemList(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = z
    .object({
      id: z.string().uuid(),
      list_id: z.string().uuid(),
      join: z.enum(['true', 'false']),
    })
    .safeParse({
      id: formData.get('id'),
      list_id: formData.get('list_id'),
      join: formData.get('join'),
    });
  if (!parsed.success) throw new Error('Missing item or list.');

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) throw new Error('That item could not be found.');

  const { data: list } = await supabase
    .from('item_lists')
    .select('id')
    .eq('id', parsed.data.list_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!list) throw new Error('That list could not be found.');

  const moved =
    parsed.data.join === 'true'
      ? await addToList(supabase, { listId: list.id, itemIds: [item.id] })
      : await removeFromList(supabase, { listId: list.id, itemIds: [item.id] });
  if (moved.error !== undefined) throw new Error(moved.error);

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
}

/**
 * Remove an inventory unit. Order line / spend history stay; the unit leaves
 * owned inventory. Restoring is not supported — use dispose when you want a record.
 */
// latency: pending
export async function deleteInventoryItem(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) throw new Error('Missing item.');

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) throw new Error('That item could not be found.');

  const { error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('id', item.id)
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/dashboard');
}

/** Every page whose contents change when an item is flagged for sale. */
function revalidateSellSurfaces(itemIds: string[]): void {
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/sell');
  for (const id of itemIds) revalidatePath(`/shopping/inventory/${id}`);
}

/**
 * Flag owned items for sale, or clear the flag.
 *
 * The sell assistant routes what it can price, which means books and games
 * with a confirmed identity. This is the other half: the user saying "I want
 * to sell this" about anything they own, which the sell page then lists
 * whether or not a catalog has ever heard of it.
 *
 * Takes a list because the inventory page selects rows — one item is the same
 * call with one id.
 */
// latency: pending
export async function setItemsForSale(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const forSale = String(formData.get('for_sale') ?? 'true') === 'true';
  const ids = formData
    .getAll('id')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);
  if (ids.length === 0) return { error: 'Pick at least one item first.' };

  // Owned only, and only this user's: a disposed or returned unit is not
  // something to put on the sell page.
  const flagged = await setUnitsFlag(supabase, { userId: user.id, ids, column: 'for_sale', value: forSale });
  if (!flagged.ok) return { error: flagged.error };
  const ownedIds = flagged.ids;
  if (ownedIds.length === 0) {
    return { error: 'None of those are owned items.' };
  }

  revalidateSellSurfaces(ownedIds);
  const noun = ownedIds.length === 1 ? 'item' : 'items';
  return {
    message: forSale
      ? `${ownedIds.length} ${noun} marked for sale.`
      : `${ownedIds.length} ${noun} taken off the sell page.`,
  };
}

/**
 * Delete the selected inventory units.
 *
 * The row menu deletes one at a time, which is the wrong shape for clearing out
 * a shelf of duplicates. Same rule as the single delete: the order line and the
 * spend history stay, the unit leaves inventory, and there is no undo — which
 * is why the bar asks a second time before calling this.
 */
// latency: pending
export async function deleteInventoryItems(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const ids = formData
    .getAll('id')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);
  if (ids.length === 0) return { error: 'Pick at least one item first.' };

  // Read back what is actually the user's before deleting, so the count in the
  // message is the number of rows that really went.
  const { data: owned } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('user_id', user.id)
    .in('id', ids);
  const mine = (owned ?? []).map((row) => row.id as string);
  if (mine.length === 0) return { error: 'Those items could not be found.' };

  const { error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('user_id', user.id)
    .in('id', mine);
  if (error) return { error: error.message };

  revalidateSellSurfaces(mine);
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/dashboard');
  return {
    message: `${mine.length} ${mine.length === 1 ? 'item' : 'items'} deleted.`,
  };
}

/** Form-action friendly wrapper for list-row icon buttons. */
// latency: pending -- should be optimistic: a toggle that waits for the round trip
export async function toggleItemForSaleForm(formData: FormData): Promise<void> {
  const result = await setItemsForSale({}, formData);
  if (result.error) throw new Error(result.error);
}
