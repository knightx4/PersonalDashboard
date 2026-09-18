'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { todayInTimezone } from '@/lib/money';

export type ActionState = {
  error?: string;
  message?: string;
  /** Set by markItemReturned, so the toast's Undo can hand it straight back to undoItemReturned. */
  returnId?: string;
};

async function userTimezone(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return data?.timezone ?? 'UTC';
}

function revalidateReturnSurfaces(itemId: string, orderId?: string) {
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${itemId}`);
  revalidatePath('/shopping/orders');
  if (orderId) revalidatePath(`/shopping/orders/${orderId}`);
  revalidatePath('/shopping/dashboard');
}

/** Toggle whether an owned inventory unit is planned for return. */
// latency: pending
export async function setReturnPlanned(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = z
    .object({
      id: z.string().uuid(),
      planned: z.enum(['true', 'false']),
    })
    .safeParse({
      id: formData.get('id'),
      planned: formData.get('planned'),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Missing item.' };
  }

  const planned = parsed.data.planned === 'true';

  const { data: item, error: itemError } = await supabase
    .from('inventory_items')
    .select('id, status')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (itemError || !item) return { error: 'That item could not be found.' };
  if (item.status !== 'owned') {
    return { error: 'Only owned items can be marked to return.' };
  }

  const { error } = await supabase
    .from('inventory_items')
    .update({ return_planned: planned })
    .eq('id', item.id)
    .eq('user_id', user.id)
    .eq('status', 'owned');

  if (error) return { error: error.message };

  revalidateReturnSurfaces(item.id);
  return { message: planned ? 'Marked to return.' : 'Removed from to-return list.' };
}

/** Form-action friendly wrapper for list-row icon buttons. */
// latency: pending -- should be optimistic: a toggle that waits for the round trip
export async function toggleReturnPlannedForm(formData: FormData): Promise<void> {
  const result = await setReturnPlanned({}, formData);
  if (result.error) throw new Error(result.error);
}

/**
 * The same flag over a selection from the inventory list.
 *
 * Separate from setReturnPlanned rather than looping it: this is one update
 * over a set of ids, so marking twenty items costs one round trip and either
 * all of them move or none do.
 */
// latency: pending
export async function setItemsReturnPlanned(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const planned = String(formData.get('planned') ?? 'true') === 'true';
  const ids = formData
    .getAll('id')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);
  if (ids.length === 0) return { error: 'Pick at least one item first.' };

  const { data: owned } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .in('id', ids);
  const ownedIds = (owned ?? []).map((row) => row.id as string);
  if (ownedIds.length === 0) return { error: 'None of those are owned items.' };

  const { error } = await supabase
    .from('inventory_items')
    .update({ return_planned: planned })
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .in('id', ownedIds);
  if (error) return { error: error.message };

  for (const id of ownedIds) revalidateReturnSurfaces(id);
  const noun = ownedIds.length === 1 ? 'item' : 'items';
  return {
    message: planned
      ? `${ownedIds.length} ${noun} marked to return.`
      : `${ownedIds.length} ${noun} taken off the to-return list.`,
  };
}

/**
 * One-click mark returned from the tracker.
 * Inserts a refunded `returns` row; sync_order_state moves the unit to returned.
 * Refund defaults to landed cost.
 */
// latency: pending
export async function markItemReturned(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

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

  const { data: inserted, error } = await supabase
    .from('returns')
    .insert({
      user_id: user.id,
      order_id: orderItem.order_id,
      inventory_item_id: item.id,
      initiated_at: today,
      refund_amount_cents: item.cost_cents,
      status: 'refunded',
      refunded_at: today,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  revalidateReturnSurfaces(item.id, orderItem.order_id);
  return { message: 'Marked as returned.', returnId: inserted?.id as string | undefined };
}

/**
 * Undo a return: delete the refunded returns row so sync_order_state restores owned.
 */
// latency: pending
export async function undoItemReturned(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = z
    .object({
      id: z.string().uuid(),
      returnId: z.string().uuid(),
    })
    .safeParse({
      id: formData.get('id'),
      returnId: formData.get('return_id'),
    });

  if (!parsed.success) return { error: 'Missing return.' };

  const { data: item, error: itemError } = await supabase
    .from('inventory_items')
    .select('id, status, order_item_id')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (itemError || !item) return { error: 'That item could not be found.' };
  if (item.status !== 'returned') {
    return { error: 'Only returned items can be restored.' };
  }

  const { data: ret, error: retError } = await supabase
    .from('returns')
    .select('id, order_id, inventory_item_id, status')
    .eq('id', parsed.data.returnId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (retError || !ret) return { error: 'That return could not be found.' };
  if (ret.inventory_item_id !== item.id) {
    return { error: 'That return does not match this item.' };
  }
  if (ret.status !== 'refunded') {
    return { error: 'Only completed returns can be undone.' };
  }

  const { error } = await supabase
    .from('returns')
    .delete()
    .eq('id', ret.id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidateReturnSurfaces(item.id, ret.order_id as string);
  return { message: 'Restored to inventory.' };
}

/**
 * Upsert or clear a per-user merchant return window.
 *
 * - Empty input with "reset": deletes the override (back to seeded default).
 * - Empty input without reset: sets override to null (no window for this user).
 * - Number: sets that many days.
 */
// latency: pending
export async function saveMerchantReturnPolicy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const merchantId = z.string().uuid().safeParse(formData.get('merchant_id'));
  if (!merchantId.success) return { error: 'Missing merchant.' };

  const intent = String(formData.get('intent') ?? 'save');
  const rawDays = String(formData.get('return_window_days') ?? '').trim();

  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, name, default_return_window_days')
    .eq('id', merchantId.data)
    .maybeSingle();

  if (merchantError || !merchant) return { error: 'That merchant could not be found.' };

  if (intent === 'reset') {
    const { error } = await supabase
      .from('merchant_return_policies')
      .delete()
      .eq('user_id', user.id)
      .eq('merchant_id', merchant.id);
    if (error) return { error: error.message };
    revalidatePaths();
    return { message: `Restored ${merchant.name} to the default policy.` };
  }

  let days: number | null;
  if (rawDays === '') {
    days = null;
  } else {
    const parsedDays = z.coerce.number().int().min(1).max(730).safeParse(rawDays);
    if (!parsedDays.success) {
      return { error: 'Return window must be between 1 and 730 days, or blank for none.' };
    }
    days = parsedDays.data;
  }

  // If the value matches the seed, drop the override so the seed stays the source.
  if (days === (merchant.default_return_window_days as number | null)) {
    const { error } = await supabase
      .from('merchant_return_policies')
      .delete()
      .eq('user_id', user.id)
      .eq('merchant_id', merchant.id);
    if (error) return { error: error.message };
    revalidatePaths();
    return { message: `Using the default ${days ?? 'none'} day window for ${merchant.name}.` };
  }

  const { data: existing } = await supabase
    .from('merchant_return_policies')
    .select('id')
    .eq('user_id', user.id)
    .eq('merchant_id', merchant.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('merchant_return_policies')
      .update({ return_window_days: days })
      .eq('id', existing.id)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from('merchant_return_policies').insert({
      user_id: user.id,
      merchant_id: merchant.id,
      return_window_days: days,
    });
    if (error) return { error: error.message };
  }

  revalidatePaths();
  return {
    message:
      days == null
        ? `Cleared the return window for ${merchant.name}.`
        : `Set ${merchant.name} to ${days} days.`,
  };
}

/**
 * Create a user-scoped merchant and set its return window in one step.
 * Used when the retailer isn't already in the catalog.
 */
// latency: pending
export async function createMerchantReturnPolicy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const nameParsed = z
    .string()
    .trim()
    .min(2, 'Name needs at least 2 characters.')
    .max(80)
    .safeParse(formData.get('name'));
  if (!nameParsed.success) {
    return { error: nameParsed.error.issues[0]?.message ?? 'Enter a merchant name.' };
  }

  const rawDays = String(formData.get('return_window_days') ?? '').trim();
  let days: number | null;
  if (rawDays === '') {
    days = null;
  } else {
    const parsedDays = z.coerce.number().int().min(1).max(730).safeParse(rawDays);
    if (!parsedDays.success) {
      return { error: 'Return window must be between 1 and 730 days, or blank for none.' };
    }
    days = parsedDays.data;
  }

  const baseSlug =
    nameParsed.data
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'merchant';
  const slug = `${baseSlug}-${user.id.slice(0, 8)}`;

  const { data: conflict } = await supabase
    .from('merchants')
    .select('id')
    .eq('created_by_user_id', user.id)
    .eq('slug', slug)
    .maybeSingle();
  if (conflict) {
    return { error: 'You already have a merchant with that name.' };
  }

  const { data: created, error: createError } = await supabase
    .from('merchants')
    .insert({
      name: nameParsed.data,
      slug,
      domains: [],
      created_by_user_id: user.id,
      is_global: false,
      default_return_window_days: days,
    })
    .select('id, name')
    .single();

  if (createError || !created) {
    return { error: createError?.message ?? 'Could not create that merchant.' };
  }

  revalidatePaths();
  return {
    message:
      days == null
        ? `Added ${created.name} with no return window.`
        : `Added ${created.name} with a ${days}-day window.`,
  };
}

function revalidatePaths() {
  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/dashboard');
}
