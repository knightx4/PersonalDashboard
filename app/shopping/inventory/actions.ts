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
import { slugifyCategoryName } from '@/lib/categories/slugify';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import { pickListGradient } from '@/lib/lists/gradients';

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

  let categorySlug: string | null = null;
  let categoryName: string | null = null;
  if (parsed.data.categoryId) {
    const { data: category } = await supabase
      .from('categories')
      .select('slug, name')
      .eq('id', parsed.data.categoryId)
      .maybeSingle();
    categorySlug = category?.slug ?? null;
    categoryName = category?.name ?? null;
  }

  const enriched = enrichItemDisplay({
    name: parsed.data.name,
    variant: parsed.data.variant || null,
    categorySlug,
    categoryName,
  });

  const { error } = await supabase
    .from('inventory_items')
    .update({
      name: parsed.data.name,
      short_name: enriched.shortName,
      variant: parsed.data.variant || null,
      category_id: parsed.data.categoryId ?? null,
      notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
      search_tags: enriched.searchTags,
    })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${parsed.data.id}`);
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

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  revalidatePath('/shopping/orders');
  revalidatePath(`/shopping/orders/${orderItem.order_id}`);
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/dashboard');
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

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
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

  const { data: existing } = await supabase
    .from('item_lists')
    .select('color')
    .eq('user_id', user.id);
  const color = pickListGradient((existing ?? []).map((row) => row.color));

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

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: `Added to “${nameParsed.data}”.` };
}

/** One-click dispose from a list row (defaults to trashed). */
export async function quickDisposeInventoryItem(formData: FormData): Promise<void> {
  const next = new FormData();
  next.set('id', String(formData.get('id') ?? ''));
  next.set('disposal_method', String(formData.get('disposal_method') ?? 'trashed'));
  next.set('disposal_proceeds', String(formData.get('disposal_proceeds') ?? ''));
  const result = await disposeInventoryItem({}, next);
  if (result.error) throw new Error(result.error);
}

/** Add or remove one list membership without replacing the rest. */
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

  if (parsed.data.join === 'true') {
    const { data: existing } = await supabase
      .from('inventory_item_lists')
      .select('id')
      .eq('inventory_item_id', item.id)
      .eq('list_id', list.id)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase.from('inventory_item_lists').insert({
        inventory_item_id: item.id,
        list_id: list.id,
      });
      if (error) throw new Error(error.message);
    }
  } else {
    const { error } = await supabase
      .from('inventory_item_lists')
      .delete()
      .eq('inventory_item_id', item.id)
      .eq('list_id', list.id);
    if (error) throw new Error(error.message);
  }

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
}

/**
 * Remove an inventory unit. Order line / spend history stay; the unit leaves
 * owned inventory. Restoring is not supported — use dispose when you want a record.
 */
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
