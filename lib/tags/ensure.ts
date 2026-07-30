import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTagLabel, slugifyTagName } from '@/lib/tags/guess';

export type ItemTagRow = {
  id: string;
  name: string;
  slug: string;
};

/** Load the user's tag vocabulary (for rails / pickers). */
export async function loadUserTags(
  supabase: SupabaseClient,
  userId: string,
): Promise<ItemTagRow[]> {
  const { data, error } = await supabase
    .from('item_tags')
    .select('id, name, slug')
    .eq('user_id', userId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as ItemTagRow[];
}

/**
 * Find-or-create tags by label for a user. Returns ids in the same order as
 * unique normalized labels.
 */
export async function ensureItemTags(
  supabase: SupabaseClient,
  userId: string,
  labels: readonly string[],
): Promise<ItemTagRow[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = normalizeTagLabel(raw);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    unique.push(label);
  }
  if (unique.length === 0) return [];

  const existing = await loadUserTags(supabase, userId);
  const bySlug = new Map(existing.map((tag) => [tag.slug, tag]));
  const out: ItemTagRow[] = [];

  for (const label of unique) {
    const slug = slugifyTagName(label);
    if (!slug) continue;
    const hit = bySlug.get(slug);
    if (hit) {
      out.push(hit);
      continue;
    }
    const { data, error } = await supabase
      .from('item_tags')
      .insert({ user_id: userId, name: label, slug })
      .select('id, name, slug')
      .single();
    if (error || !data) {
      // Race: another request created it.
      const { data: again } = await supabase
        .from('item_tags')
        .select('id, name, slug')
        .eq('user_id', userId)
        .eq('slug', slug)
        .maybeSingle();
      if (again) {
        out.push(again as ItemTagRow);
        bySlug.set(slug, again as ItemTagRow);
      }
      continue;
    }
    const created = data as ItemTagRow;
    out.push(created);
    bySlug.set(slug, created);
  }

  return out;
}

/** Attach tags to an order line (idempotent upsert). */
export async function linkOrderItemTags(
  supabase: SupabaseClient,
  orderItemId: string,
  tagIds: readonly string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = tagIds.map((tagId) => ({
    order_item_id: orderItemId,
    tag_id: tagId,
  }));
  const { error } = await supabase
    .from('order_item_tags')
    .upsert(rows, { onConflict: 'order_item_id,tag_id', ignoreDuplicates: true });
  if (error) throw error;
}

export function parseTagId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}
