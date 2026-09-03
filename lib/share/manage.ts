import 'server-only';

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  groupKeyFor,
  regroupPlan,
  type GroupableItem,
  type ShareItemState,
} from '@/lib/share/grouping';

/**
 * The owner's side of a share: putting things on it, and keeping the cached
 * grouping honest afterwards.
 *
 * Everything here runs with the signed-in user's own client, so RLS is what
 * decides which rows are reachable -- there is no service-role client in this
 * file and no user_id taken from an argument.
 */

/** 32 bytes of base64url. Long enough that guessing is not a strategy. */
export function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

type GameDetailRow = { bgg_id: number | null; needs_confirmation: boolean };
type FamilyRow = {
  confirmed_at: string | null;
  item_families: { slug: string } | { slug: string }[] | null;
};

/** Supabase returns a 1:1 embed as an object or a one-element array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type ShareCandidate = GroupableItem & { familyKey: string | null };

/**
 * Everything the grouping needs about a set of inventory items, in one query.
 *
 * Passing no ids means "all of the owner's owned items", which is what the
 * regroup path wants -- it re-derives keys for whatever is already on a share.
 */
export async function loadShareCandidates(
  supabase: SupabaseClient,
  userId: string,
  inventoryItemIds?: readonly string[],
): Promise<ShareCandidate[]> {
  let query = supabase
    .from('inventory_items')
    .select(
      `
      id, name, short_name, fingerprint_loose,
      game_details ( bgg_id, needs_confirmation ),
      inventory_item_families ( confirmed_at, item_families ( slug ) )
    `,
    )
    .eq('user_id', userId);

  if (inventoryItemIds) {
    if (inventoryItemIds.length === 0) return [];
    query = query.in('id', [...inventoryItemIds]);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const details = one<GameDetailRow>(row.game_details as never);
    const family = one<FamilyRow>(row.inventory_item_families as never);
    const familySlug = family?.confirmed_at
      ? (one<{ slug: string }>(family.item_families as never)?.slug ?? null)
      : null;

    return {
      inventoryItemId: row.id as string,
      name: row.name as string,
      shortName: (row.short_name as string | null) ?? null,
      bggId: details?.bgg_id ?? null,
      needsConfirmation: details?.needs_confirmation ?? false,
      isGame: details != null,
      fingerprintLoose: (row.fingerprint_loose as string | null) ?? null,
      familyKey: familySlug,
    };
  });
}

/**
 * Put items on a share.
 *
 * Idempotent: the unique key on (share, subject type, subject id) means adding
 * the same box twice is a no-op rather than a second unit, which matters
 * because "add all the board games" is a button someone will press twice.
 */
export async function addItemsToShare(
  supabase: SupabaseClient,
  userId: string,
  shareLinkId: string,
  inventoryItemIds: readonly string[],
): Promise<{ added: number }> {
  const candidates = await loadShareCandidates(supabase, userId, inventoryItemIds);
  if (candidates.length === 0) return { added: 0 };

  const rows = candidates.map((item) => ({
    share_link_id: shareLinkId,
    subject_type: 'inventory_item' as const,
    subject_id: item.inventoryItemId,
    group_key: groupKeyFor(item),
    family_key: item.familyKey,
  }));

  const { data, error } = await supabase
    .from('share_link_items')
    .upsert(rows, {
      onConflict: 'share_link_id,subject_type,subject_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) throw error;

  const added = data?.length ?? 0;
  if (added > 0) {
    await supabase.from('share_link_events').insert({
      share_link_id: shareLinkId,
      kind: 'item_added',
      payload: { count: added },
    });
  }
  return { added };
}

export async function removeItemsFromShare(
  supabase: SupabaseClient,
  shareLinkId: string,
  inventoryItemIds: readonly string[],
): Promise<void> {
  if (inventoryItemIds.length === 0) return;
  const { error } = await supabase
    .from('share_link_items')
    .delete()
    .eq('share_link_id', shareLinkId)
    .in('subject_id', [...inventoryItemIds]);
  if (error) throw error;

  await supabase.from('share_link_events').insert({
    share_link_id: shareLinkId,
    kind: 'item_removed',
    payload: { count: inventoryItemIds.length },
  });
}

/**
 * Recompute the cached group keys, and move or drop the answers that depended
 * on them.
 *
 * Confirming a BGG id or fixing a title changes what a unit's key should be,
 * and then an answer is filed under a key nothing points at. The planning is
 * pure and tested (lib/share/grouping.ts); this applies it, and writes an
 * event for every answer that moved or was dropped -- silence there would be a
 * form that quietly lost what she said.
 */
export async function regroupShare(
  supabase: SupabaseClient,
  userId: string,
  shareLinkId: string,
): Promise<{ updated: number; moved: number; dropped: number }> {
  const { data: items, error: itemsError } = await supabase
    .from('share_link_items')
    .select('id, subject_id, group_key')
    .eq('share_link_id', shareLinkId)
    .eq('subject_type', 'inventory_item');
  if (itemsError) throw itemsError;

  const rows = items ?? [];
  const candidates = await loadShareCandidates(
    supabase,
    userId,
    rows.map((r) => r.subject_id as string),
  );
  const byId = new Map(candidates.map((c) => [c.inventoryItemId, c]));

  const state: ShareItemState[] = rows.flatMap((row) => {
    const item = byId.get(row.subject_id as string);
    if (!item) return [];
    return [{ shareLinkItemId: row.id as string, cachedGroupKey: row.group_key as string, item }];
  });

  const { data: answers, error: answersError } = await supabase
    .from('share_link_responses')
    .select('id, group_key')
    .eq('share_link_id', shareLinkId);
  if (answersError) throw answersError;

  const plan = regroupPlan(
    state,
    (answers ?? []).map((a) => a.group_key as string),
  );

  const familyById = new Map(candidates.map((c) => [c.inventoryItemId, c.familyKey]));
  for (const update of plan.updates) {
    const row = rows.find((r) => r.id === update.shareLinkItemId);
    await supabase
      .from('share_link_items')
      .update({
        group_key: update.to,
        family_key: row ? (familyById.get(row.subject_id as string) ?? null) : null,
      })
      .eq('id', update.shareLinkItemId);
  }

  // Drops first: a move into a key a dropped answer still occupies would
  // otherwise trip the unique index.
  for (const drop of plan.drops) {
    await supabase
      .from('share_link_responses')
      .delete()
      .eq('share_link_id', shareLinkId)
      .eq('group_key', drop.groupKey);
  }

  for (const move of plan.moves) {
    await supabase
      .from('share_link_responses')
      .update({ group_key: move.to })
      .eq('share_link_id', shareLinkId)
      .eq('group_key', move.from);
  }

  if (plan.updates.length > 0 || plan.drops.length > 0 || plan.moves.length > 0) {
    await supabase.from('share_link_events').insert({
      share_link_id: shareLinkId,
      kind: 'regrouped',
      payload: {
        updated: plan.updates.length,
        moved: plan.moves.map((m) => `${m.from} -> ${m.to}`),
        dropped: plan.drops.map((d) => `${d.groupKey} (${d.reason})`),
      },
    });
  }

  return {
    updated: plan.updates.length,
    moved: plan.moves.length,
    dropped: plan.drops.length,
  };
}
