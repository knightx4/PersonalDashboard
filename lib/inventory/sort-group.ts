export const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'price_desc', label: 'Price: high to low' },
  { id: 'price_asc', label: 'Price: low to high' },
  { id: 'merchant', label: 'Merchant' },
] as const;

export type SortId = (typeof SORT_OPTIONS)[number]['id'];

export const GROUP_OPTIONS = [
  { id: 'none', label: 'No grouping' },
  { id: 'category', label: 'Category' },
  { id: 'merchant', label: 'Merchant' },
  { id: 'month', label: 'Month acquired' },
] as const;

export type GroupId = (typeof GROUP_OPTIONS)[number]['id'];

export function parseSortId(raw: string | undefined): SortId {
  return SORT_OPTIONS.some((o) => o.id === raw) ? (raw as SortId) : 'newest';
}

export function parseGroupId(raw: string | undefined): GroupId {
  return GROUP_OPTIONS.some((o) => o.id === raw) ? (raw as GroupId) : 'none';
}

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

export function sortInventoryItems<T extends SortableInventoryItem>(
  items: T[],
  sort: SortId,
): T[] {
  const copy = [...items];
  const byName = (a: T, b: T) =>
    displayNameOf(a).localeCompare(displayNameOf(b), undefined, { sensitivity: 'base' });

  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => {
        const da = a.acquired_at ?? '';
        const db = b.acquired_at ?? '';
        return da.localeCompare(db) || byName(a, b);
      });
    case 'name':
      return copy.sort(byName);
    case 'price_desc':
      return copy.sort((a, b) => b.cost_cents - a.cost_cents || byName(a, b));
    case 'price_asc':
      return copy.sort((a, b) => a.cost_cents - b.cost_cents || byName(a, b));
    case 'merchant':
      return copy.sort((a, b) => {
        const ma = a.merchant_name ?? 'zzz';
        const mb = b.merchant_name ?? 'zzz';
        return ma.localeCompare(mb) || byName(a, b);
      });
    case 'newest':
    default:
      return copy.sort((a, b) => {
        const da = a.acquired_at ?? '';
        const db = b.acquired_at ?? '';
        return db.localeCompare(da) || byName(a, b);
      });
  }
}

export type InventoryGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

function monthLabel(isoDate: string | null): { key: string; label: string } {
  if (!isoDate || isoDate.length < 7) return { key: 'unknown', label: 'Unknown date' };
  const key = isoDate.slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  const label = date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key, label };
}

export function groupInventoryItems<T extends SortableInventoryItem>(
  items: T[],
  group: GroupId,
): InventoryGroup<T>[] {
  if (group === 'none') {
    return [{ key: 'all', label: 'All items', items }];
  }

  const buckets = new Map<string, InventoryGroup<T>>();

  for (const item of items) {
    let key: string;
    let label: string;
    if (group === 'category') {
      label = item.category_name?.trim() || 'Uncategorized';
      key = label.toLowerCase();
    } else if (group === 'merchant') {
      label = item.merchant_name?.trim() || 'No merchant';
      key = label.toLowerCase();
    } else {
      ({ key, label } = monthLabel(item.acquired_at));
    }

    const bucket = buckets.get(key) ?? { key, label, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => {
    if (group === 'month') return b.key.localeCompare(a.key);
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
}
