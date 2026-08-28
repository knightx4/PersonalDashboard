/** Shared orders list search matching (merchant, items, tags, email subject, …). */

export function sanitizeOrdersQuery(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type OrderListItemTag = {
  id?: string;
  name: string;
  slug?: string;
};

export type OrderListItem = {
  name: string;
  variant: string | null;
  quantity?: number | null;
  categories?: { name: string } | { name: string }[] | null;
  /** Nested join shape from PostgREST, or a flat tag list after normalizing. */
  order_item_tags?:
    | Array<{
        tag_id?: string;
        item_tags: OrderListItemTag | OrderListItemTag[] | null;
      }>
    | null;
  tags?: OrderListItemTag[] | null;
};

export type OrderSearchRow = {
  status: string;
  external_order_number: string | null;
  merchants: { name: string } | { name: string }[] | null;
  order_items: OrderListItem[] | null;
  /**
   * Attached after the fact rather than embedded: the envelope lives in core
   * now, and PostgREST cannot embed across schemas. Loaded from this schema's
   * inbox_messages view and stitched on by resulting_order_id.
   */
  ingested_messages:
    | Array<{
        subject: string | null;
        from_address: string | null;
        classification?: string | null;
        email_address?: string | null;
      }>
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Flatten PostgREST order_item_tags → item_tags into a simple tag list. */
export function orderItemTags(item: OrderListItem): OrderListItemTag[] {
  if (item.tags && item.tags.length > 0) return item.tags;
  const out: OrderListItemTag[] = [];
  for (const row of item.order_item_tags ?? []) {
    const tag = one(row.item_tags);
    if (tag?.name) out.push(tag);
  }
  return out;
}

/** True when any line on the order carries this tag id. */
export function orderHasTagId(
  order: Pick<OrderSearchRow, 'order_items'>,
  tagId: string,
): boolean {
  for (const item of order.order_items ?? []) {
    for (const row of item.order_item_tags ?? []) {
      const tag = one(row.item_tags);
      if (row.tag_id === tagId || tag?.id === tagId) return true;
    }
    for (const tag of item.tags ?? []) {
      if (tag.id === tagId) return true;
    }
  }
  return false;
}

/** Inbox address that produced this order (prefer confirmation message). */
export function orderInboxAddress(order: Pick<OrderSearchRow, 'ingested_messages'>): string | null {
  const messages = order.ingested_messages ?? [];
  const preferred =
    messages.find((message) => message.classification === 'order_confirmation') ?? messages[0];
  return preferred?.email_address ?? null;
}

export function orderMatchesQuery(order: OrderSearchRow, q: string): boolean {
  const needle = q.toLowerCase();
  const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
  const parts: Array<string | null | undefined> = [
    merchant?.name,
    order.external_order_number,
    order.status,
    order.status.replaceAll('_', ' '),
    orderInboxAddress(order),
  ];
  for (const item of order.order_items ?? []) {
    parts.push(item.name, item.variant);
    const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
    parts.push(category?.name);
    for (const tag of orderItemTags(item)) {
      parts.push(tag.name, tag.slug ?? null);
    }
  }
  for (const message of order.ingested_messages ?? []) {
    parts.push(message.subject, message.from_address);
  }
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

export function matchingItemHint(
  order: Pick<OrderSearchRow, 'order_items'>,
  q: string,
): string | null {
  const needle = q.toLowerCase();
  for (const item of order.order_items ?? []) {
    if (item.name.toLowerCase().includes(needle)) return item.name;
    if (item.variant?.toLowerCase().includes(needle)) {
      return `${item.name} · ${item.variant}`;
    }
    for (const tag of orderItemTags(item)) {
      if (tag.name.toLowerCase().includes(needle) || tag.slug?.toLowerCase().includes(needle)) {
        return `${item.name} · ${tag.name}`;
      }
    }
  }
  return null;
}

/** Shorten long retailer titles for list rows (prefer text before first comma). */
export function shortItemLabel(name: string, max = 48): string {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Item';
  const beforeComma = cleaned.split(',')[0]?.trim() || cleaned;
  const base = beforeComma.length >= 12 ? beforeComma : cleaned;
  if (base.length <= max) return base;
  return `${base.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export type OrderItemsSummary = {
  itemCount: number;
  lineCount: number;
  /** e.g. "2 items · Clothing · shoes · Baseball Hat, NYU T Shirt" */
  label: string;
};

/**
 * Compact list-row summary: unit count, optional category kinds, tags, short item names.
 */
export function orderItemsSummary(
  order: Pick<OrderSearchRow, 'order_items'>,
): OrderItemsSummary {
  const items = order.order_items ?? [];
  const lineCount = items.length;
  const itemCount = items.reduce((sum, item) => {
    const qty = item.quantity == null || item.quantity < 1 ? 1 : item.quantity;
    return sum + qty;
  }, 0);

  if (itemCount === 0) {
    return { itemCount: 0, lineCount: 0, label: 'No items' };
  }

  const countLabel = itemCount === 1 ? '1 item' : `${itemCount} items`;

  const kinds = new Set<string>();
  const tagNames = new Set<string>();
  for (const item of items) {
    const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
    if (category?.name) kinds.add(category.name);
    for (const tag of orderItemTags(item)) {
      if (tag.name) tagNames.add(tag.name);
    }
  }
  const kindLabel =
    kinds.size > 0 && kinds.size <= 3 ? [...kinds].join(', ') : null;
  const tagLabel =
    tagNames.size > 0
      ? [...tagNames].sort((a, b) => a.localeCompare(b)).slice(0, 3).join(', ')
      : null;

  const maxNames = 2;
  const names = items.slice(0, maxNames).map((item) => shortItemLabel(item.name));
  const remaining = Math.max(0, lineCount - maxNames);
  const namesLabel =
    remaining > 0 ? `${names.join(', ')} +${remaining} more` : names.join(', ');

  const parts = [countLabel];
  if (kindLabel) parts.push(kindLabel);
  if (tagLabel) parts.push(tagLabel);
  if (namesLabel) parts.push(namesLabel);

  return {
    itemCount,
    lineCount,
    label: parts.join(' · '),
  };
}
