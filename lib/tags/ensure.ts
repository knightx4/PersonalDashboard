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

/** A line's tag as tagOrderItem left it: the tag, whether it was made for this, and the new link (null when the line had it already). */
export type OrderItemTagging = { tag: ItemTagRow; madeTag: boolean; link: Record<string, unknown> | null };

/**
 * Tag one order line by the tag's label, making the tag when they have none
 * by that name, as the order page's tag chips and Dash's order_item_tags both
 * do (plan #2473.4). The caller has checked the line is on an order of
 * theirs. Null when the label has nothing a tag can be made of.
 */
export async function tagOrderItem(
  supabase: SupabaseClient,
  opts: { userId: string; orderItemId: string; label: string },
): Promise<OrderItemTagging | null> {
  const label = normalizeTagLabel(opts.label);
  if (!label) return null;
  const slug = slugifyTagName(label);
  if (!slug) return null;
  const { data: had, error: readError } = await supabase
    .from('item_tags')
    .select('id, name, slug')
    .eq('user_id', opts.userId)
    .eq('slug', slug)
    .maybeSingle();
  if (readError) throw readError;
  const [tag] = had ? [had as ItemTagRow] : await ensureItemTags(supabase, opts.userId, [label]);
  if (!tag) return null;
  const { data: linked, error: linkReadError } = await supabase
    .from('order_item_tags')
    .select('id')
    .eq('order_item_id', opts.orderItemId)
    .eq('tag_id', tag.id)
    .maybeSingle();
  if (linkReadError) throw linkReadError;
  if (linked) return { tag, madeTag: !had, link: null };
  const { data: link, error } = await supabase
    .from('order_item_tags')
    .insert({ order_item_id: opts.orderItemId, tag_id: tag.id })
    .select('*')
    .single();
  if (error || !link) throw error ?? new Error('The line was not tagged.');
  return { tag, madeTag: !had, link: link as Record<string, unknown> };
}

/**
 * Take one of their tags off an order line, as the order page's chip and
 * Dash's order_item_tags both do (plan #2473.4). Hands back the links it
 * took away, whole, so Dash can put them back; none when the tag is not
 * theirs or the line did not carry it.
 */
export async function untagOrderItem(
  supabase: SupabaseClient,
  opts: { userId: string; orderItemId: string; tagId: string },
): Promise<Record<string, unknown>[]> {
  const { data: owned, error: ownError } = await supabase
    .from('item_tags')
    .select('id')
    .eq('id', opts.tagId)
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (ownError) throw ownError;
  if (!owned) return [];
  const { data: links, error: readError } = await supabase
    .from('order_item_tags')
    .select('*')
    .eq('order_item_id', opts.orderItemId)
    .eq('tag_id', opts.tagId);
  if (readError) throw readError;
  if (!links || links.length === 0) return [];
  const { error } = await supabase
    .from('order_item_tags')
    .delete()
    .eq('order_item_id', opts.orderItemId)
    .eq('tag_id', opts.tagId);
  if (error) throw error;
  return links as Record<string, unknown>[];
}

export function parseTagId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}
