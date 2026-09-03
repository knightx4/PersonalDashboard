import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { todayInTimezone } from '@/lib/money';
import { planGroupApplication } from '@/lib/share/apply-plan';

/**
 * Turning an answer into a change.
 *
 * Her marks are a proposal. Nothing she does on the shared page touches
 * `inventory_items` -- a link that can silently flip forty rows to `sold` is a
 * link you cannot send. This is the deliberate, per-group step where I accept
 * one of them.
 *
 * "Sell two of these three" has to become two specific rows, and which two is
 * a question with no meaningful answer: they are identical boxes. So the
 * choice is by id, ascending -- arbitrary, but repeatable and explainable,
 * which is what matters when someone asks later why that one and not the other.
 *
 * Keep is not an action. It is the absence of one, so nothing is written for
 * it beyond taking the units off the outstanding count.
 */

export type ApplyResult = {
  sold: number;
  givenAway: number;
  /** Set when the answer asked for more than is still owned. */
  shortfall: number;
};

async function userTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return (data?.timezone as string | undefined) ?? 'UTC';
}

export async function applyGroupDecision(
  supabase: SupabaseClient,
  userId: string,
  input: { shareLinkId: string; groupKey: string; sellQty: number; giveawayQty: number },
): Promise<ApplyResult> {
  const wanted = Math.max(0, input.sellQty) + Math.max(0, input.giveawayQty);
  if (wanted === 0) return { sold: 0, givenAway: 0, shortfall: 0 };

  // Still-owned units in this group, oldest id first. The status filter is the
  // same one share_page() applies, so what I act on is what she was looking at.
  const { data, error } = await supabase
    .from('share_link_items')
    .select('subject_id, inventory_items!inner ( id, status, user_id )')
    .eq('share_link_id', input.shareLinkId)
    .eq('group_key', input.groupKey)
    .eq('subject_type', 'inventory_item')
    .eq('inventory_items.user_id', userId)
    .eq('inventory_items.status', 'owned')
    .order('subject_id', { ascending: true });

  if (error) throw error;

  const ownedIds = (data ?? []).map((row) => row.subject_id as string);

  const { data: response } = await supabase
    .from('share_link_responses')
    .select('id, keep_qty, sell_qty, giveaway_qty')
    .eq('share_link_id', input.shareLinkId)
    .eq('group_key', input.groupKey)
    .maybeSingle();

  const plan = planGroupApplication({
    ownedIds,
    sellQty: input.sellQty,
    giveawayQty: input.giveawayQty,
    response: response
      ? {
          keepQty: response.keep_qty as number,
          sellQty: response.sell_qty as number,
          giveawayQty: response.giveaway_qty as number,
        }
      : null,
  });

  const disposedAt = todayInTimezone(await userTimezone(supabase, userId));

  // Guarded on status = 'owned' as well as id, so two clicks in a row cannot
  // dispose of the same unit twice, and a unit sold from the inventory page a
  // moment ago is left alone.
  async function mark(
    itemIds: string[],
    status: 'sold' | 'gifted',
    method: 'sold' | 'gifted',
  ): Promise<number> {
    if (itemIds.length === 0) return 0;
    const { data: updated, error: updateError } = await supabase
      .from('inventory_items')
      .update({ status, disposed_at: disposedAt, disposal_method: method })
      .in('id', itemIds)
      .eq('user_id', userId)
      .eq('status', 'owned')
      .select('id');
    if (updateError) throw updateError;
    return updated?.length ?? 0;
  }

  const sold = await mark(plan.sellIds, 'sold', 'sold');
  const givenAway = await mark(plan.giveIds, 'gifted', 'gifted');

  // The answer has been acted on, so it must stop standing.
  if (response) {
    if (plan.nextResponse === null) {
      await supabase.from('share_link_responses').delete().eq('id', response.id);
    } else {
      await supabase
        .from('share_link_responses')
        .update({
          keep_qty: plan.nextResponse.keepQty,
          sell_qty: plan.nextResponse.sellQty,
          giveaway_qty: plan.nextResponse.giveawayQty,
        })
        .eq('id', response.id);
    }
  }

  await supabase.from('share_link_events').insert({
    share_link_id: input.shareLinkId,
    kind: 'item_removed',
    group_key: input.groupKey,
    payload: { applied: true, sold, givenAway },
  });

  return { sold, givenAway, shortfall: plan.shortfall };
}
