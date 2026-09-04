/**
 * What you marked for sale, and how each of those things gets priced.
 *
 * The sell assistant used to be organised by what the catalog recognised: a
 * books list, a games list, and a third list of flagged items that carried no
 * price because nothing could look them up. This module is the other way round
 * — the flag comes first, and identity is only a detail of how the price is
 * found:
 *
 *   a confirmed ISBN      the strongest query there is, and the only one with a
 *                         buyback vendor on the other end
 *   a confirmed BGG id    a title search, cached against the game
 *   anything else         a title search, cached against the item itself
 *
 * The third case is what makes the page work for a blender, and it is also
 * where a book whose edition is unsettled lands — it can still be priced by
 * title, it just is not filed against an ISBN nobody has confirmed.
 *
 * One decision, in one function (`priceTargetOf`), because the loader reading
 * the cache and the run writing it must never disagree about where a price
 * lives.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { gamePriceQuery } from '@/lib/sell/game-query';
import {
  parseAttributeValues,
  searchTermsFor,
  templateFor,
} from '@/lib/inventory/attributes';

export type SellItemKind = 'book' | 'game' | 'item';

export type ForSaleItem = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  costCents: number;
  kind: SellItemKind;
  isbn13: string | null;
  bggId: number | null;
  authors: string[];
  publisher: string | null;
  yearPublished: number | null;
  /** True while the user has not settled which printing or edition this is. */
  needsConfirmation: boolean;
  /** A price typed by hand — on whichever of the three tables holds it. */
  manualCents: number | null;
  /**
   * The attribute values this item's category template says belong in the
   * search — an edition, a pressing, a model number. Empty for almost
   * everything, because the flag is off until somebody turns it on.
   */
  searchTerms: string[];
};

/** Where a looked-up price for this item is cached, and what to search for. */
export type PriceTarget =
  | { via: 'isbn'; isbn13: string }
  | { via: 'bgg'; bggId: number; query: string; hint: string }
  | { via: 'item'; inventoryItemId: string; query: string; hint: string };

/**
 * An unconfirmed edition falls through to the title search rather than being
 * refused: "price everything I marked" has to mean everything, and a title is
 * how the page prices most of what is on it now.
 */
export function priceTargetOf(item: ForSaleItem): PriceTarget {
  if (item.kind === 'book' && item.isbn13 && !item.needsConfirmation) {
    return { via: 'isbn', isbn13: item.isbn13 };
  }
  if (item.kind === 'game' && item.bggId != null && !item.needsConfirmation) {
    return {
      via: 'bgg',
      bggId: item.bggId,
      ...gamePriceQuery({
        name: item.name,
        yearPublished: item.yearPublished,
        publisher: item.publisher,
      }),
    };
  }
  // Only this branch. The other two are cached under an ISBN or a BGG id --
  // identifiers shared with every other copy of the same thing -- so an
  // item's own words in the query would write one item's answer into every
  // owner's cache. They also do not need it: an ISBN already pins an edition.
  return {
    via: 'item',
    inventoryItemId: item.inventoryItemId,
    query: [item.shortName || item.name, ...item.searchTerms].join(' ').trim(),
    hint: 'Used, in good condition, sold on eBay.',
  };
}

const SELECT = `
  id, name, short_name, image_url, cost_cents, manual_expected_price_cents,
  category_id, attributes,
  categories ( name, slug ),
  book_details (
    isbn_13, authors, publisher, published_year, needs_confirmation,
    manual_expected_price_cents
  ),
  game_details (
    bgg_id, publisher, year_published, needs_confirmation,
    manual_expected_price_cents
  )
`;

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Everything owned and flagged for sale, in the order the page shows it. */
export async function loadForSaleItems(input: {
  supabase: SupabaseClient;
  userId: string;
  /** Narrow to specific items — the "price these ones" path. */
  ids?: string[];
}): Promise<ForSaleItem[]> {
  const { supabase, userId, ids } = input;
  if (ids && ids.length === 0) return [];

  let query = supabase
    .from('inventory_items')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('status', 'owned')
    .eq('for_sale', true);
  if (ids) query = query.in('id', ids);

  const { data } = await query.order('name');
  const rows = data ?? [];

  // One query for every template the user has edited, rather than one per
  // item. Categories nobody has edited fall through to the built-in template,
  // which needs no row at all.
  const templateByCategory = new Map<string, unknown>();
  const categoryIds = [
    ...new Set(rows.map((row) => row.category_id as string | null).filter((id): id is string => !!id)),
  ];
  if (categoryIds.length > 0) {
    const { data: templates } = await supabase
      .from('category_attribute_templates')
      .select('category_id, fields')
      .eq('user_id', userId)
      .in('category_id', categoryIds);
    for (const template of templates ?? []) {
      templateByCategory.set(template.category_id as string, template.fields);
    }
  }

  return rows.map((row) => {
    const category = first(
      row.categories as { name: string; slug: string } | { name: string; slug: string }[] | null,
    );
    const categoryId = (row.category_id as string | null) ?? null;
    const book = first(
      row.book_details as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const game = first(
      row.game_details as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const detail = book ?? game;

    return {
      inventoryItemId: row.id as string,
      name: row.name as string,
      shortName: (row.short_name as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      categoryName: category?.name ?? null,
      costCents: (row.cost_cents as number | null) ?? 0,
      kind: book ? 'book' : game ? 'game' : 'item',
      isbn13: (book?.isbn_13 as string | null) ?? null,
      bggId: (game?.bgg_id as number | null) ?? null,
      authors: (book?.authors as string[] | null) ?? [],
      publisher: (detail?.publisher as string | null) ?? null,
      yearPublished: (game?.year_published as number | null) ?? null,
      needsConfirmation: Boolean(detail?.needs_confirmation),
      // Exactly one of the three columns can apply: the item's own is read only
      // when it has no detail row at all, so a cleared book price never falls
      // through to a stale number left on the item.
      manualCents: detail
        ? ((detail.manual_expected_price_cents as number | null) ?? null)
        : ((row.manual_expected_price_cents as number | null) ?? null),
      searchTerms: searchTermsFor(
        templateFor({
          categorySlug: category?.slug ?? null,
          savedFields: categoryId ? templateByCategory.get(categoryId) : null,
          hasSavedTemplate: categoryId ? templateByCategory.has(categoryId) : false,
        }),
        parseAttributeValues(row.attributes),
      ),
    } satisfies ForSaleItem;
  });
}
