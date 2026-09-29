import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Marking an owned item returned, and taking that back.
 *
 * The returns page (app/shopping/returns/actions.ts) and a change Dash made
 * from Ask Dash (lib/ask/changes.ts, plan #1189) both go through these, so a
 * return reads the same whichever of them wrote it: a full refund at what the
 * item cost, refunded today. The database's sync_order_state marks the item
 * returned when the row goes in and owned again when it is deleted.
 *
 * No `server-only` and no client of its own: the caller passes the person's
 * public-schema client, so row level security decides what is theirs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicClient = SupabaseClient<any, any, any>;

export type MarkReturned =
  | { ok: true; returnId: string; orderId: string; refundCents: number | null }
  | { ok: false; error: string };

export async function markReturned(
  supabase: PublicClient,
  userId: string,
  itemId: string,
  today: string,
): Promise<MarkReturned> {
  const { data: item, error: itemError } = await supabase
    .from('inventory_items')
    .select('id, cost_cents, status, order_item_id')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle();

  if (itemError || !item) return { ok: false, error: 'That item could not be found.' };
  if (item.status !== 'owned') return { ok: false, error: 'Only owned items can be marked returned.' };
  if (!item.order_item_id) {
    return { ok: false, error: 'This item is not linked to an order, so it cannot be returned.' };
  }

  const { data: orderItem, error: orderItemError } = await supabase
    .from('order_items')
    .select('order_id')
    .eq('id', item.order_item_id)
    .maybeSingle();
  if (orderItemError || !orderItem) return { ok: false, error: 'Could not find the parent order.' };

  const refundCents = (item.cost_cents as number | null) ?? null;
  const { data: inserted, error } = await supabase
    .from('returns')
    .insert({
      user_id: userId,
      order_id: orderItem.order_id,
      inventory_item_id: item.id,
      initiated_at: today,
      refund_amount_cents: refundCents,
      status: 'refunded',
      refunded_at: today,
    })
    .select('id')
    .single();

  if (error || !inserted) return { ok: false, error: error?.message ?? 'The return was not written.' };
  return { ok: true, returnId: inserted.id as string, orderId: orderItem.order_id as string, refundCents };
}

export type UnmarkReturned = { ok: true; orderId: string } | { ok: false; error: string };

/** Delete the refunded returns row, so sync_order_state puts the item back to owned. */
export async function unmarkReturned(
  supabase: PublicClient,
  userId: string,
  itemId: string,
  returnId: string,
): Promise<UnmarkReturned> {
  const { data: item, error: itemError } = await supabase
    .from('inventory_items')
    .select('id, status, order_item_id')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle();

  if (itemError || !item) return { ok: false, error: 'That item could not be found.' };
  if (item.status !== 'returned') return { ok: false, error: 'Only returned items can be restored.' };

  const { data: ret, error: retError } = await supabase
    .from('returns')
    .select('id, order_id, inventory_item_id, status')
    .eq('id', returnId)
    .eq('user_id', userId)
    .maybeSingle();

  if (retError || !ret) return { ok: false, error: 'That return could not be found.' };
  if (ret.inventory_item_id !== item.id) return { ok: false, error: 'That return does not match this item.' };
  if (ret.status !== 'refunded') return { ok: false, error: 'Only completed returns can be undone.' };

  const { error } = await supabase.from('returns').delete().eq('id', ret.id).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, orderId: ret.order_id as string };
}
