import type { SupabaseClient } from '@supabase/supabase-js';
import { DISMISSED_REVIEW_ERROR } from '@/lib/inbox/merchant-exclusion-match';

/**
 * The review queue's moves, as its buttons, its bulk bar, the Deleted orders
 * list and Dash's review_orders all make them (plan #2473.4), so the two
 * cannot drift. Each takes the user explicitly, so it works the same on the
 * page's client (RLS) and on the connector's service role, and hands back
 * the rows it moved as they are now. The verdict rows (ingested_messages)
 * keep no account id: the caller has read the emails through inbox_messages,
 * which carries the owner, before naming them here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
type Row = Record<string, unknown>;

export type ReviewMove<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** The reason a discarded order's email carries, so a re-scan does not bring the order back. */
export const DISCARDED_REVIEW_ERROR = 'Discarded from review queue';

/** Confirm orders that are still waiting (`needsReview` false), or put them back in the queue (true). */
export async function setOrdersReview(
  supabase: Client,
  opts: { userId: string; ids: readonly string[]; needsReview: boolean },
): Promise<ReviewMove<{ orders: Row[] }>> {
  if (opts.ids.length === 0) return { ok: true, orders: [] };
  const { data, error } = await supabase
    .from('orders')
    .update({ needs_review: opts.needsReview })
    .in('id', [...opts.ids])
    .eq('user_id', opts.userId)
    .is('deleted_at', null)
    .select('*');
  if (error) return { ok: false, error: error.message };
  return { ok: true, orders: (data ?? []) as Row[] };
}

/**
 * Discard orders: each goes to Deleted orders, out of the queue, and the
 * emails it was read from are skipped with the reason, so a re-scan does not
 * make it again. Hands back the orders as they are now and their emails as
 * they were, so the bulk bar's undo and Dash's can put them back.
 */
export async function discardOrders(
  supabase: Client,
  opts: { userId: string; ids: readonly string[]; now?: string },
): Promise<ReviewMove<{ orders: Row[]; sources: Row[] }>> {
  if (opts.ids.length === 0) return { ok: true, orders: [], sources: [] };
  const { data: sourceData, error: sourceError } = await supabase
    .from('inbox_messages')
    .select('*')
    .in('resulting_order_id', [...opts.ids])
    .eq('user_id', opts.userId);
  if (sourceError) return { ok: false, error: sourceError.message };
  const sources = (sourceData ?? []) as Row[];

  if (sources.length > 0) {
    const { error: messageError } = await supabase
      .from('ingested_messages')
      .update({ parse_status: 'skipped', resulting_order_id: null, error: DISCARDED_REVIEW_ERROR })
      .in(
        'id',
        sources.map((row) => row.id as string),
      );
    if (messageError) return { ok: false, error: messageError.message };
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ deleted_at: opts.now ?? new Date().toISOString(), needs_review: false })
    .in('id', [...opts.ids])
    .eq('user_id', opts.userId)
    .select('*');
  if (error) return { ok: false, error: error.message };
  return { ok: true, orders: (data ?? []) as Row[], sources };
}

/** Bring deleted orders back, into the review queue again when `reviewAgain`. */
export async function restoreOrders(
  supabase: Client,
  opts: { userId: string; ids: readonly string[]; reviewAgain: boolean },
): Promise<ReviewMove<{ orders: Row[] }>> {
  if (opts.ids.length === 0) return { ok: true, orders: [] };
  const values: Row = opts.reviewAgain ? { deleted_at: null, needs_review: true } : { deleted_at: null };
  const { data, error } = await supabase
    .from('orders')
    .update(values)
    .in('id', [...opts.ids])
    .eq('user_id', opts.userId)
    .not('deleted_at', 'is', null)
    .select('*');
  if (error) return { ok: false, error: error.message };
  return { ok: true, orders: (data ?? []) as Row[] };
}

/** Dismiss waiting emails from the queue; the ledger row stays. */
export async function dismissEmails(supabase: Client, opts: { ids: readonly string[] }): Promise<ReviewMove<{ messages: Row[] }>> {
  if (opts.ids.length === 0) return { ok: true, messages: [] };
  const { data, error } = await supabase
    .from('ingested_messages')
    .update({ parse_status: 'skipped', error: DISMISSED_REVIEW_ERROR })
    .in('id', [...opts.ids])
    .select('*');
  if (error) return { ok: false, error: error.message };
  return { ok: true, messages: (data ?? []) as Row[] };
}

/** An email as it is to be put back: its status, its reason, and the order it was read into when it had one. */
export type MessageBack = { id: string; parseStatus: string; error: string | null; resultingOrderId?: string | null };

/** Put emails back as they were, each with its own status and reason. */
export async function putMessagesBack(supabase: Client, messages: readonly MessageBack[]): Promise<ReviewMove<{ messages: Row[] }>> {
  const out: Row[] = [];
  // One statement per message, because each goes back to its own status and
  // its own error. A selection is tens of rows, not thousands.
  for (const message of messages) {
    const values: Row = { parse_status: message.parseStatus, error: message.error };
    if (message.resultingOrderId !== undefined) values.resulting_order_id = message.resultingOrderId;
    const { data, error } = await supabase.from('ingested_messages').update(values).eq('id', message.id).select('*');
    if (error) return { ok: false, error: error.message };
    out.push(...((data ?? []) as Row[]));
  }
  return { ok: true, messages: out };
}
