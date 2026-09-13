import {
  NO_GROUP,
  type GroupBucket,
  type ListDisplaySpec,
} from '@/lib/list-display';

/**
 * What the inventory list offers: six sorts, four groupings, and the columns a
 * row can lose.
 *
 * The sorts and the groupings were a pair of hand-rolled switch statements
 * beside this list and nothing else could use them. As a declaration they are
 * read by the shared display module, which does the parsing, the ordering, the
 * bucketing and the links -- so the ids and the defaults here are the whole of
 * what makes an old inventory link still open the view it opened before.
 */

export type SortableInventoryItem = {
  name: string;
  short_name: string | null;
  cost_cents: number;
  acquired_at: string | null;
  merchant_name?: string | null;
  category_name?: string | null;
};

export function displayNameOf(item: { short_name: string | null; name: string }): string {
  return item.short_name?.trim() || item.name;
}

/** The grouping that was the default before this list had a control. */
export const DEFAULT_INVENTORY_GROUP = NO_GROUP;

function byName<T extends SortableInventoryItem>(a: T, b: T): number {
  return displayNameOf(a).localeCompare(displayNameOf(b), undefined, { sensitivity: 'base' });
}

function byDate<T extends SortableInventoryItem>(a: T, b: T): number {
  return (a.acquired_at ?? '').localeCompare(b.acquired_at ?? '');
}

function monthBucket(acquiredAt: string | null): GroupBucket | null {
  if (!acquiredAt || acquiredAt.length < 7) return null;
  const key = acquiredAt.slice(0, 7);
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
  return {
    key,
    label: date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

function named(value: string | null | undefined): GroupBucket | null {
  const label = value?.trim();
  if (!label) return null;
  return { key: label.toLowerCase(), label };
}

/**
 * The declaration, generic over the row so the page can pass its own shape --
 * a stacked row carrying a quantity and a unit cost range -- without the
 * comparators here having to know about any of it.
 */
export function inventoryDisplay<T extends SortableInventoryItem>(): ListDisplaySpec<T> {
  return {
    pathname: '/shopping/inventory',
    sorts: [
      { id: 'newest', label: 'Newest', compare: (a, b) => byDate(b, a) || byName(a, b) },
      { id: 'oldest', label: 'Oldest', compare: (a, b) => byDate(a, b) || byName(a, b) },
      { id: 'name', label: 'Name A–Z', compare: byName },
      {
        id: 'price_desc',
        label: 'Price: high to low',
        compare: (a, b) => b.cost_cents - a.cost_cents || byName(a, b),
      },
      {
        id: 'price_asc',
        label: 'Price: low to high',
        compare: (a, b) => a.cost_cents - b.cost_cents || byName(a, b),
      },
      {
        id: 'merchant',
        label: 'Merchant',
        // A row with no merchant sorted last here before the grouping rules
        // existed, and still does: the placeholder was 'zzz'.
        compare: (a, b) =>
          (a.merchant_name ?? 'zzz').localeCompare(b.merchant_name ?? 'zzz') || byName(a, b),
      },
    ],
    groups: [
      {
        id: 'category',
        label: 'Category',
        bucket: (item) => named(item.category_name),
        emptyLabel: 'Uncategorized',
      },
      {
        id: 'merchant',
        label: 'Merchant',
        bucket: (item) => named(item.merchant_name),
        emptyLabel: 'No merchant',
      },
      {
        id: 'month',
        label: 'Month acquired',
        bucket: (item) => monthBucket(item.acquired_at),
        order: 'key-desc',
        emptyLabel: 'Unknown date',
      },
    ],
    properties: [
      { id: 'name', label: 'Name', alwaysOn: true },
      { id: 'price', label: 'Price' },
      { id: 'category', label: 'Category' },
      { id: 'merchant', label: 'Merchant' },
      { id: 'acquired', label: 'Date acquired' },
    ],
    defaultSort: 'newest',
    defaultGroup: NO_GROUP,
  };
}
