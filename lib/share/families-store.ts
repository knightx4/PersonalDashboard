import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { suggestFamilies, type FamilyCandidate, type FamilySuggestion } from '@/lib/share/families';

/**
 * Suggestions, and the decisions people make about them.
 *
 * The suggester is pure (lib/share/families.ts). This is the part that knows
 * what has already been decided, so a proposal a person rejected last week is
 * not put in front of them again -- which is the whole reason
 * inventory_item_families keeps a rejected row rather than deleting it.
 */

/** A suggestion with the member names filled in, so the card can be read. */
export type PendingSuggestion = Omit<FamilySuggestion, 'members'> & {
  members: Array<FamilySuggestion['members'][number] & { name: string }>;
};

async function decidedPairs(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ pairs: Set<string>; livelyGrouped: Set<string> }> {
  const { data } = await supabase
    .from('inventory_item_families')
    .select('inventory_item_id, confirmed_at, rejected_at, item_families!inner ( slug, user_id )')
    .eq('item_families.user_id', userId);

  const pairs = new Set<string>();
  const livelyGrouped = new Set<string>();

  for (const row of data ?? []) {
    const family = Array.isArray(row.item_families) ? row.item_families[0] : row.item_families;
    const slug = (family as { slug?: string } | null)?.slug;
    const itemId = row.inventory_item_id as string;
    if (slug) pairs.add(`${itemId}::${slug}`);
    if (row.confirmed_at) livelyGrouped.add(itemId);
  }

  return { pairs, livelyGrouped };
}

/**
 * What is worth asking about.
 *
 * A suggestion survives only if at least two of its members are still
 * undecided -- re-proposing a family where one straggler is left is a question
 * that cannot change anything.
 */
export async function loadFamilySuggestions(
  supabase: SupabaseClient,
  userId: string,
): Promise<PendingSuggestion[]> {
  const { data } = await supabase
    .from('inventory_items')
    .select('id, name, short_name, game_details!inner ( inventory_item_id )')
    .eq('user_id', userId)
    .eq('status', 'owned');

  const candidates: FamilyCandidate[] = (data ?? []).map((row) => ({
    inventoryItemId: row.id as string,
    name: row.name as string,
    shortName: (row.short_name as string | null) ?? null,
  }));

  const nameById = new Map(
    candidates.map((c) => [c.inventoryItemId, c.shortName?.trim() || c.name]),
  );
  const { pairs, livelyGrouped } = await decidedPairs(supabase, userId);

  return suggestFamilies(candidates)
    .map((family) => ({
      ...family,
      members: family.members
        .filter(
          (m) =>
            !pairs.has(`${m.inventoryItemId}::${family.slug}`) &&
            !livelyGrouped.has(m.inventoryItemId),
        )
        .map((m) => ({ ...m, name: nameById.get(m.inventoryItemId) ?? '' })),
    }))
    .filter((family) => family.members.length > 1);
}

async function familyIdFor(
  supabase: SupabaseClient,
  userId: string,
  slug: string,
  name: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('item_families')
    .select('id')
    .eq('user_id', userId)
    .eq('slug', slug)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await supabase
    .from('item_families')
    .insert({ user_id: userId, slug, name })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Could not create that family.');
  return data.id as string;
}

/** Say yes. The members are grouped from here on, and the form shows a heading. */
export async function confirmFamily(
  supabase: SupabaseClient,
  userId: string,
  input: {
    slug: string;
    name: string;
    members: Array<{ inventoryItemId: string; role: string; confidence: number }>;
  },
): Promise<number> {
  const familyId = await familyIdFor(supabase, userId, input.slug, input.name);
  const itemIds = input.members.map((m) => m.inventoryItemId);

  // One live family per item, enforced by a partial unique index. An item
  // moving between families has to leave the first, so clear any live
  // membership before writing the new one rather than colliding with it.
  await supabase
    .from('inventory_item_families')
    .delete()
    .in('inventory_item_id', itemIds)
    .is('rejected_at', null)
    .neq('family_id', familyId);

  const rows = input.members.map((member, index) => ({
    inventory_item_id: member.inventoryItemId,
    family_id: familyId,
    role: member.role,
    source: 'title_cluster' as const,
    position: index,
    confidence: member.confidence,
    confirmed_at: new Date().toISOString(),
    rejected_at: null,
  }));

  const { error } = await supabase
    .from('inventory_item_families')
    .upsert(rows, { onConflict: 'inventory_item_id,family_id' });
  if (error) throw error;

  return rows.length;
}

/**
 * Say no, and mean it.
 *
 * A tombstone rather than a deletion. Without it the suggester proposes the
 * same grouping on every run and rejecting it is not a decision that sticks --
 * which is precisely the complaint people have about this kind of feature.
 */
export async function rejectFamily(
  supabase: SupabaseClient,
  userId: string,
  input: { slug: string; name: string; inventoryItemIds: string[] },
): Promise<number> {
  const familyId = await familyIdFor(supabase, userId, input.slug, input.name);

  const rows = input.inventoryItemIds.map((id) => ({
    inventory_item_id: id,
    family_id: familyId,
    source: 'title_cluster' as const,
    confirmed_at: null,
    rejected_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('inventory_item_families')
    .upsert(rows, { onConflict: 'inventory_item_id,family_id' });
  if (error) throw error;

  return rows.length;
}
