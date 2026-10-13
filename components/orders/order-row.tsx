import Link from '@/components/ui/link';
import { MerchantAvatar } from '@/components/merchants/merchant-avatar';
import { OrderRowMenu } from '@/components/orders/order-row-menu';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { PersonBadge } from '@/components/people/person-badge';
import type { Person } from '@/lib/people/load';

const STATUS_TONES: Record<string, ChipTone> = {
  ordered: 'accent',
  shipped: 'accent',
  delivered: 'neutral',
  partially_returned: 'caution',
  returned: 'positive',
  cancelled: 'neutral',
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
  /** Whose order this is. Null on a one-person account, and on old data. */
  person?: Person | null;
};

export function OrderRow({ order }: { order: OrderRowData }) {
  const statusTone = STATUS_TONES[order.status] ?? 'neutral';
  const meta = [
    formatOrderDate(order.order_date),
    order.external_order_number ? `#${order.external_order_number}` : null,
    order.inbox,
  ].filter(Boolean);

  return (
    <li className="group flex items-stretch transition-colors duration-quick hover:bg-canvas">
      <Link
        href={`/shopping/orders/${order.id}`}
        className={cn(
          'row-pad flex min-w-0 flex-1 items-center gap-3 pl-3 pr-2 transition-colors duration-quick',
          'focus-visible:bg-canvas focus-visible:outline-none',
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
            <Chip tone={statusTone} size="sm">
              {statusLabel(order.status)}
            </Chip>
            <PersonBadge person={order.person} />
          </div>
          <p className="mt-0.5 truncate text-ui text-ink-muted">
            {order.items_label}
            {order.item_hint && !order.items_label.includes(order.item_hint)
              ? ` · ${order.item_hint}`
              : ''}
          </p>
          <p className="mt-0.5 truncate text-small text-ink-muted">{meta.join(' · ')}</p>
        </div>

        <p className="tabular shrink-0 text-right text-body font-semibold text-ink">
          {formatMoney(order.total_cents, order.currency)}
          {order.native_currency &&
            order.native_total_cents != null &&
            order.native_currency !== order.currency && (
              <span className="mt-0.5 block text-micro font-normal text-ink-muted">
                {formatMoney(order.native_total_cents, order.native_currency)}
              </span>
            )}
        </p>
      </Link>

      <div className="flex shrink-0 items-center pr-2">
        <OrderRowMenu orderId={order.id} merchantName={order.merchant_name} />
      </div>
    </li>
  );
}
