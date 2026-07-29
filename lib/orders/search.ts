/** Shared orders list search matching (merchant, items, email subject, …). */

export function sanitizeOrdersQuery(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type OrderSearchRow = {
  status: string;
  external_order_number: string | null;
  merchants: { name: string } | { name: string }[] | null;
  order_items: Array<{ name: string; variant: string | null }> | null;
  ingested_messages:
    | Array<{ subject: string | null; from_address: string | null }>
    | null;
};

export function orderMatchesQuery(order: OrderSearchRow, q: string): boolean {
  const needle = q.toLowerCase();
  const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
  const parts: Array<string | null | undefined> = [
    merchant?.name,
    order.external_order_number,
    order.status,
    order.status.replaceAll('_', ' '),
  ];
  for (const item of order.order_items ?? []) {
    parts.push(item.name, item.variant);
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
