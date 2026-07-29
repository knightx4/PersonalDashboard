/** Shared orders list search matching (merchant, items, email subject, …). */

export function sanitizeOrdersQuery(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type OrderListItem = {
  name: string;
  variant: string | null;
  quantity?: number | null;
  categories?: { name: string } | { name: string }[] | null;
};

export type OrderSearchRow = {
  status: string;
  external_order_number: string | null;
  merchants: { name: string } | { name: string }[] | null;
  order_items: OrderListItem[] | null;
  ingested_messages:
    | Array<{
        subject: string | null;
        from_address: string | null;
        classification?: string | null;
        email_accounts?:
          | { email_address: string }
          | Array<{ email_address: string }>
          | null;
      }>
    | null;
};

/** Inbox address that produced this order (prefer confirmation message). */
export function orderInboxAddress(order: Pick<OrderSearchRow, 'ingested_messages'>): string | null {
  const messages = order.ingested_messages ?? [];
  const preferred =
    messages.find((message) => message.classification === 'order_confirmation') ?? messages[0];
  if (!preferred) return null;
  const account = Array.isArray(preferred.email_accounts)
    ? preferred.email_accounts[0]
    : preferred.email_accounts;
  return account?.email_address ?? null;
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
  /** e.g. "2 items · Clothing · Baseball Hat, NYU T Shirt" */
  label: string;
};

/**
 * Compact list-row summary: unit count, optional category kinds, short item names.
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
  for (const item of items) {
    const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
    if (category?.name) kinds.add(category.name);
  }
  const kindLabel =
    kinds.size > 0 && kinds.size <= 3 ? [...kinds].join(', ') : null;

  const maxNames = 2;
  const names = items.slice(0, maxNames).map((item) => shortItemLabel(item.name));
  const remaining = Math.max(0, lineCount - maxNames);
  const namesLabel =
    remaining > 0 ? `${names.join(', ')} +${remaining} more` : names.join(', ');

  const parts = [countLabel];
  if (kindLabel) parts.push(kindLabel);
  if (namesLabel) parts.push(namesLabel);

  return {
    itemCount,
    lineCount,
    label: parts.join(' · '),
  };
}
