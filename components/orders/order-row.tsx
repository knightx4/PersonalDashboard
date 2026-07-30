import Link from 'next/link';
import { MerchantAvatar } from '@/components/merchants/merchant-avatar';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

const STATUS_STYLES: Record<string, string> = {
  ordered: 'bg-brand-tint text-brand',
  shipped: 'bg-brand-tint text-brand',
  delivered: 'bg-canvas text-ink-muted',
  partially_returned: 'bg-accent-orange-tint text-accent-orange',
  returned: 'bg-positive-tint text-positive',
  cancelled: 'bg-canvas text-ink-faint',
};

function formatOrderDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export type OrderRowData = {
  id: string;
  order_date: string;
  total_cents: number;
  currency: string;
  /** When set and different from currency, shown as a muted native amount. */
  native_total_cents?: number;
  native_currency?: string;
  status: string;
  external_order_number: string | null;
  merchant_name: string;
  merchant_logo_url: string | null;
  merchant_domains: string[] | null;
  items_label: string;
  item_hint: string | null;
  inbox: string | null;
};

export function OrderRow({ order }: { order: OrderRowData }) {
  const statusClass = STATUS_STYLES[order.status] ?? 'bg-canvas text-ink-muted';
  const meta = [
    formatOrderDate(order.order_date),
    order.external_order_number ? `#${order.external_order_number}` : null,
    order.inbox,
  ].filter(Boolean);

  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        className={cn(
          'group flex items-center gap-3 px-3 py-3 transition-colors duration-150',
          'hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none',
        )}
      >
        <MerchantAvatar
          name={order.merchant_name}
          logoUrl={order.merchant_logo_url}
          domains={order.merchant_domains}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-semibold text-ink">{order.merchant_name}</p>
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                statusClass,
              )}
            >
              {statusLabel(order.status)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-muted">
            {order.items_label}
            {order.item_hint && !order.items_label.includes(order.item_hint)
              ? ` · ${order.item_hint}`
              : ''}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-ink-faint">{meta.join(' · ')}</p>
        </div>

        <p className="tabular shrink-0 text-right text-[15px] font-semibold text-ink">
          {formatMoney(order.total_cents, order.currency)}
          {order.native_currency &&
            order.native_total_cents != null &&
            order.native_currency !== order.currency && (
              <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">
                {formatMoney(order.native_total_cents, order.native_currency)}
              </span>
            )}
        </p>
      </Link>
    </li>
  );
}
