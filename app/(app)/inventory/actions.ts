'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  DISPOSAL_METHODS,
  inventoryStatusForDisposal,
  type DisposalMethod,
} from '@/lib/inventory/status-actions';
import { parseDollarsToCents, todayInTimezone } from '@/lib/money';
import {
  CATEGORY_COLOR_OPTIONS,
  isCategoryColor,
  slugifyCategoryName,
} from '@/lib/categories/slugify';

export interface ActionState {
  error?: string;
  message?: string;
}

async function userTimezone(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return data?.timezone ?? 'UTC';
}

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

  const { error } = await supabase
    .from('inventory_items')
    .update({
      name: parsed.data.name,
      variant: parsed.data.variant || null,
      category_id: parsed.data.categoryId ?? null,
      notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
    })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${parsed.data.id}`);
  return { message: 'Saved.' };
}

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
  const disposedAt = todayInTimezone(timezone);
  const status = inventoryStatusForDisposal(method);

  const { error } = await supabase
    .from('inventory_items')
    .update({
      status,
      disposed_at: disposedAt,
      disposal_method: method,
      disposal_proceeds_cents: proceedsCents > 0 ? proceedsCents : null,
    })
    .eq('id', id.data)
    .eq('user_id', user.id)
    .eq('status', 'owned');

  if (error) return { error: error.message };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${id.data}`);
  revalidatePath('/orders');
  return { message: 'Marked as disposed.' };
}

/**
 * Mark returned by inserting a refunded `returns` row.
 *
 * Never writes inventory_items.status = 'returned' — the trigger-owned
 * sync_order_state() function does that from the return.
 */
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

  const { data: item, error: itemError } = await supabase
    .from('inventory_items')
    .select('id, cost_cents, status, order_item_id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();

  if (itemError || !item) return { error: 'That item could not be found.' };
  if (item.status !== 'owned') return { error: 'Only owned items can be marked returned.' };
  if (!item.order_item_id) {
    return { error: 'This item is not linked to an order, so it cannot be returned.' };
  }

  const { data: orderItem, error: orderItemError } = await supabase
    .from('order_items')
    .select('order_id')
    .eq('id', item.order_item_id)
    .maybeSingle();
  if (orderItemError || !orderItem) return { error: 'Could not find the parent order.' };

  const timezone = await userTimezone(supabase, user.id);
  const today = todayInTimezone(timezone);
  const amount = refundCents === -1 ? item.cost_cents : refundCents;

  const { error } = await supabase.from('returns').insert({
    user_id: user.id,
    order_id: orderItem.order_id,
    inventory_item_id: item.id,
    initiated_at: today,
    refund_amount_cents: amount,
    status: 'refunded',
    refunded_at: today,
  });

  if (error) return { error: error.message };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderItem.order_id}`);
  revalidatePath('/returns');
  revalidatePath('/dashboard');
  return { message: 'Marked as returned.' };
}

/** Replace list memberships for one inventory item with the submitted checklist. */
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

  const { data: ownedLists } = await supabase
    .from('item_lists')
    .select('id')
    .eq('user_id', user.id);
  const ownedIds = new Set((ownedLists ?? []).map((row) => row.id as string));
  const nextIds = selected.filter((id) => ownedIds.has(id));

  const { error: deleteError } = await supabase
    .from('inventory_item_lists')
    .delete()
    .eq('inventory_item_id', item.id);
  if (deleteError) return { error: deleteError.message };

  if (nextIds.length > 0) {
    const { error: insertError } = await supabase.from('inventory_item_lists').insert(
      nextIds.map((listId) => ({
        inventory_item_id: item.id,
        list_id: listId,
      })),
    );
    if (insertError) return { error: insertError.message };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  return { message: 'Lists updated.' };
}

/** Create a list from an inventory item page and add this item to it. */
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

  const colorRaw = String(formData.get('color') ?? CATEGORY_COLOR_OPTIONS[0]);
  const color = isCategoryColor(colorRaw) ? colorRaw : CATEGORY_COLOR_OPTIONS[0];
  const slug = slugifyCategoryName(nameParsed.data);
  if (!slug) return { error: 'Use letters or numbers in the list name.' };

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', itemId.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'That item could not be found.' };

  const { data: conflict } = await supabase
    .from('item_lists')
    .select('id')
    .eq('user_id', user.id)
    .eq('slug', slug)
    .maybeSingle();
  if (conflict) return { error: 'That list name is already used. Try another.' };

  const { data: created, error: createError } = await supabase
    .from('item_lists')
    .insert({
      user_id: user.id,
      name: nameParsed.data,
      slug,
      color,
    })
    .select('id')
    .single();
  if (createError || !created) {
    return { error: createError?.message ?? 'Could not create that list.' };
  }

  const { error: membershipError } = await supabase.from('inventory_item_lists').insert({
    inventory_item_id: item.id,
    list_id: created.id,
  });
  if (membershipError) return { error: membershipError.message };

  revalidatePath('/settings');
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  return { message: `Added to “${nameParsed.data}”.` };
}
