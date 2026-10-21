import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OwnedBookBundle } from '@/lib/books/create-owned-book';
import { fingerprintLoose } from '@/lib/fingerprint';
import type { OwnedGameBundle } from '@/lib/games/create-owned-game';
import { enrichItemDisplay } from './enrich-display';

/**
 * Adding what the person owns to the inventory, as the add pages (books,
 * board games, anything else) and Dash's add_items all write it (plan
 * #2473.4): the rows each kind is saved as, and one insert of the items and
 * their book or game details, so the two cannot drift on a column.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
type Row = Record<string, unknown>;

/** What a person can say about one copy beyond what the catalog gives: their notes, its cost, the day they got it. */
export type OwnedExtras = { notes?: string | null; costCents?: number; acquiredOn?: string | null };

function itemRow(bundle: OwnedBookBundle | OwnedGameBundle, extras: OwnedExtras): Row {
  return {
    id: bundle.inventory.id,
    user_id: bundle.inventory.userId,
    order_item_id: null,
    category_id: bundle.inventory.categoryId,
    name: bundle.inventory.name,
    short_name: bundle.inventory.shortName,
    variant: bundle.inventory.variant,
    image_url: bundle.inventory.imageUrl,
    fingerprint_loose: bundle.inventory.fingerprintLoose,
    acquired_at: extras.acquiredOn ?? bundle.inventory.acquiredAt,
    cost_cents: extras.costCents ?? bundle.inventory.costCents,
    search_tags: bundle.inventory.searchTags,
    notes: extras.notes ?? null,
    source: bundle.inventory.source,
    status: bundle.inventory.status,
  };
}

/** A book's inventory row and its book_details row. */
export function ownedBookRows(bundle: OwnedBookBundle, extras: OwnedExtras = {}): { item: Row; details: Row } {
  const d = bundle.bookDetails;
  return {
    item: itemRow(bundle, extras),
    details: {
      id: d.id,
      inventory_item_id: d.inventoryItemId,
      isbn_13: d.isbn13,
      isbn_10: d.isbn10,
      authors: d.authors,
      edition: d.edition,
      publisher: d.publisher,
      published_year: d.publishedYear,
      weight_grams: d.weightGrams,
      condition: d.condition ?? null,
      resolution_source: d.resolutionSource,
      match_confidence: d.matchConfidence,
      needs_confirmation: d.needsConfirmation,
      candidates: d.candidates,
      confirmation_reason: d.confirmationReason,
      auto_imported: false,
    },
  };
}

/** A board game's inventory row and its game_details row. */
export function ownedGameRows(bundle: OwnedGameBundle, extras: OwnedExtras = {}): { item: Row; details: Row } {
  const d = bundle.gameDetails;
  return {
    item: itemRow(bundle, extras),
    details: {
      id: d.id,
      inventory_item_id: d.inventoryItemId,
      bgg_id: d.bggId,
      wikidata_id: d.wikidataId,
      barcode: d.barcode,
      year_published: d.yearPublished,
      publisher: d.publisher,
      min_players: d.minPlayers,
      max_players: d.maxPlayers,
      playing_time_minutes: d.playingTimeMinutes,
      condition: null,
      resolution_source: d.resolutionSource,
      match_confidence: d.matchConfidence,
      needs_confirmation: d.needsConfirmation,
      candidates: d.candidates,
      confirmation_reason: d.confirmationReason,
      auto_imported: d.autoImported,
    },
  };
}

/**
 * Anything else they own, typed in: its search tags carry its category's
 * words, so an item filed under "Kitchen" is found by them, and a product
 * barcode when one was scanned.
 */
export function manualItemRow(opts: {
  userId: string;
  name: string;
  variant: string | null;
  notes: string | null;
  category: { id: string; slug: string; name: string } | null;
  costCents: number;
  acquiredOn: string;
  barcode?: string | null;
}): Row {
  const enriched = enrichItemDisplay({
    name: opts.name,
    variant: opts.variant,
    categorySlug: opts.category?.slug ?? null,
    categoryName: opts.category?.name ?? null,
  });
  return {
    id: randomUUID(),
    user_id: opts.userId,
    order_item_id: null,
    category_id: opts.category?.id ?? null,
    name: opts.name,
    short_name: enriched.shortName,
    variant: opts.variant,
    image_url: null,
    fingerprint_loose: fingerprintLoose(opts.name),
    acquired_at: opts.acquiredOn,
    cost_cents: opts.costCents,
    search_tags: opts.barcode ? [...enriched.searchTags, opts.barcode] : enriched.searchTags,
    notes: opts.notes,
    source: 'manual',
    status: 'owned',
  };
}

/**
 * Insert items with their book and game details. When the details cannot go
 * in, the items are taken out again, so nothing is left half added.
 */
export async function insertOwned(
  supabase: Client,
  opts: { userId: string; items: Row[]; books?: Row[]; games?: Row[] },
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (opts.items.length === 0) return { ok: true, ids: [] };
  const { error } = await supabase.from('inventory_items').insert(opts.items);
  if (error) return { ok: false, error: error.message };
  const ids = opts.items.map((row) => row.id as string);
  for (const [table, rows] of [
    ['book_details', opts.books ?? []],
    ['game_details', opts.games ?? []],
  ] as const) {
    if (rows.length === 0) continue;
    const { error: detailError } = await supabase.from(table).insert(rows);
    if (detailError) {
      await supabase.from('inventory_items').delete().eq('user_id', opts.userId).in('id', ids);
      return { ok: false, error: detailError.message };
    }
  }
  return { ok: true, ids };
}
