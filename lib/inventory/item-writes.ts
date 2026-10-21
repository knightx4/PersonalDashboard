import type { SupabaseClient } from '@supabase/supabase-js';
import { sellIdentityOf } from '@/lib/sell/item-quote';
import { enrichItemDisplay } from './enrich-display';
import { stackSiblingIds } from './stack-siblings';

/**
 * Changes to one item, as the item page, the sell page and Dash's change_item
 * all make them (plan #2473.4), so the two cannot drift. Each takes the user
 * explicitly, so it works the same on the page's client (RLS) and on the
 * connector's service role. The book and game details keep no user_id: the
 * caller checks the item is theirs before writing them. Each hands back what
 * it wrote over, so Dash can keep its Undo.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
type Row = Record<string, unknown>;

export type ItemWrite<T> = ({ ok: true } & T) | { ok: false; error: string };

/** What describes the item rather than the box, so it reaches every copy in its stack. */
export type ItemDescription = Partial<{
  name: string;
  variant: string | null;
  notes: string | null;
  category_id: string | null;
  attributes: unknown;
}>;

/**
 * Write a name, variant, notes, category or attributes to every copy in the
 * item's stack. A new name, variant or category gets the short name and search
 * tags worked out again; notes are trimmed, and empty clears them. Hands back
 * the copies written, each as it was, and the values written.
 */
export async function describeItem(
  supabase: Client,
  opts: { userId: string; itemId: string; values: ItemDescription },
): Promise<ItemWrite<{ ids: string[]; before: Row[]; values: Row }>> {
  const { data: item, error: readError } = await supabase
    .from('inventory_items')
    .select('id, name, variant, category_id')
    .eq('id', opts.itemId)
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!item) return { ok: false, error: 'That item could not be found.' };

  const values: Row = { ...opts.values };
  if ('variant' in values) values.variant = (values.variant as string | null) || null;
  if ('notes' in values) values.notes = typeof values.notes === 'string' && values.notes.trim() ? values.notes.trim() : null;
  if ('name' in values || 'variant' in values || 'category_id' in values) {
    const categoryId = 'category_id' in values ? (values.category_id as string | null) : (item.category_id as string | null);
    let categorySlug: string | null = null;
    let categoryName: string | null = null;
    if (categoryId) {
      const { data: category } = await supabase.from('categories').select('slug, name').eq('id', categoryId).maybeSingle();
      categorySlug = (category?.slug as string | undefined) ?? null;
      categoryName = (category?.name as string | undefined) ?? null;
    }
    const enriched = enrichItemDisplay({
      name: (values.name as string | undefined) ?? (item.name as string),
      variant: 'variant' in values ? (values.variant as string | null) : (item.variant as string | null),
      categorySlug,
      categoryName,
    });
    values.short_name = enriched.shortName;
    values.search_tags = enriched.searchTags;
  }

  const ids = await stackSiblingIds(supabase, opts.userId, opts.itemId);
  const { data: before, error: beforeError } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('user_id', opts.userId)
    .in('id', ids);
  if (beforeError) return { ok: false, error: beforeError.message };
  const { data: written, error } = await supabase
    .from('inventory_items')
    .update(values)
    .in('id', ids)
    .eq('user_id', opts.userId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  const done = new Set(((written ?? []) as Row[]).map((row) => row.id as string));
  return {
    ok: true,
    ids: [...done],
    before: ((before ?? []) as Row[]).filter((row) => done.has(row.id as string)),
    values,
  };
}

/** Add a line to the end of one item's notes. */
export async function addItemNote(
  supabase: Client,
  opts: { userId: string; itemId: string; note: string },
): Promise<ItemWrite<{ before: string | null; after: string }>> {
  const { data: item, error: readError } = await supabase
    .from('inventory_items')
    .select('id, notes')
    .eq('id', opts.itemId)
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!item) return { ok: false, error: 'Item not found.' };
  const before = (item.notes as string | null) ?? null;
  const after = before ? `${before}\n${opts.note}` : opts.note;
  const { error } = await supabase.from('inventory_items').update({ notes: after }).eq('id', opts.itemId).eq('user_id', opts.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, before, after };
}

/** Rename the item a group of copies stands for, at most 200 characters. */
export async function renameGroup(
  supabase: Client,
  opts: { userId: string; groupId: string; name: string },
): Promise<ItemWrite<{ name: string }>> {
  const name = opts.name.trim().slice(0, 200);
  const { data, error } = await supabase
    .from('item_groups')
    .update({ name })
    .eq('id', opts.groupId)
    .eq('user_id', opts.userId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'That group could not be found.' };
  return { ok: true, name };
}

/** What "this is the right edition" writes to a book's or a game's details. */
export const EDITION_CONFIRMED = { needs_confirmation: false, candidates: [], confirmation_reason: null } as const;

/** Write a book's or a game's details: its condition, or its edition confirmed. */
export async function writeItemDetails(
  supabase: Client,
  opts: { itemId: string; table: 'book_details' | 'game_details'; values: Row },
): Promise<ItemWrite<object>> {
  const { error } = await supabase.from(opts.table).update(opts.values).eq('inventory_item_id', opts.itemId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Set the price they mean to sell an item for, or clear it (null), where the
 * sell page reads it: a book's or a game's details, or the item itself.
 * Writes nothing when it is that already.
 */
export async function setItemSellPrice(
  supabase: Client,
  opts: { userId: string; itemId: string; cents: number | null },
): Promise<ItemWrite<{ table: 'inventory_items' | 'book_details' | 'game_details'; id: string; before: number | null; changed: boolean }>> {
  const identity = await sellIdentityOf(supabase, opts.itemId);
  const table = identity?.kind === 'book' ? 'book_details' : identity?.kind === 'game' ? 'game_details' : 'inventory_items';
  const read =
    table === 'inventory_items'
      ? supabase.from(table).select('id, manual_expected_price_cents').eq('id', opts.itemId).eq('user_id', opts.userId)
      : supabase.from(table).select('id, manual_expected_price_cents').eq('inventory_item_id', opts.itemId);
  const { data: target, error: readError } = await read.maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!target) return { ok: false, error: 'Item not found.' };
  const before = (target.manual_expected_price_cents as number | null) ?? null;
  const id = target.id as string;
  if (before === opts.cents) return { ok: true, table, id, before, changed: false };
  const write = supabase.from(table).update({ manual_expected_price_cents: opts.cents }).eq('id', id);
  const { error } = table === 'inventory_items' ? await write.eq('user_id', opts.userId) : await write;
  if (error) return { ok: false, error: error.message };
  return { ok: true, table, id, before, changed: true };
}
