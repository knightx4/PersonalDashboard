import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { formatMoney, lineSubtotalCents } from '@/lib/money';

export const metadata = { title: 'Order' };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { id } = await params;

  const { data: order } = await supabase
    .from('orders')
    .select(
      `
      id, order_date, status, source, external_order_number, return_deadline, needs_review,
      subtotal_cents, tax_cents, shipping_cents, discount_cents, total_cents, currency,
      merchants ( id, name ),
      order_items (
        id, name, variant, quantity, unit_price_cents, category_id,
        categories ( name ),
        inventory_items ( id, cost_cents, status )
      )
    `,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!order) notFound();

  const { data: sourceMessage } = await supabase
    .from('ingested_messages')
    .select('provider_message_id, thread_id, subject, from_address')
    .eq('resulting_order_id', id)
    .maybeSingle();

  const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
  const items = order.order_items ?? [];
  const gmailHref = sourceMessage?.thread_id
    ? `https://mail.google.com/mail/u/0/#all/${sourceMessage.thread_id}`
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={merchant?.name ?? sourceMessage?.subject?.slice(0, 48) ?? 'Order'}
        description={`${order.order_date}${
          order.external_order_number ? ` · #${order.external_order_number}` : ''
        } · ${order.status.replaceAll('_', ' ')}${
          order.needs_review ? ' · needs review' : ''
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            {gmailHref && (
              <a
                href={gmailHref}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Open in Gmail
              </a>
            )}
            <Link href="/orders" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              All orders
            </Link>
          </div>
        }
      />

      {sourceMessage?.subject && (
        <p className="text-sm text-ink-muted">
          From email: {sourceMessage.subject}
          {sourceMessage.from_address ? ` · ${sourceMessage.from_address}` : ''}
        </p>
      )}
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[12px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2 font-semibold">Item</th>
              <th className="px-4 py-2 font-semibold">Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Unit</th>
              <th className="px-4 py-2 text-right font-semibold">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => {
              const category = Array.isArray(item.categories)
                ? item.categories[0]
                : item.categories;
              const units = item.inventory_items ?? [];
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-[13px] text-ink-muted">
                      {[item.variant, category?.name].filter(Boolean).join(' · ') || '—'}
                    </p>
                    {units.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {units.map((unit) => (
                          <li key={unit.id}>
                            <Link
                              href={`/inventory/${unit.id}`}
                              className="text-[13px] text-brand hover:underline"
                            >
                              Unit · {formatMoney(unit.cost_cents, order.currency)} ·{' '}
                              {unit.status}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 align-top text-ink-muted">{item.quantity}</td>
                  <td className="tabular px-4 py-3 align-top text-right text-ink">
                    {formatMoney(item.unit_price_cents, order.currency)}
                  </td>
                  <td className="tabular px-4 py-3 align-top text-right text-ink">
                    {formatMoney(
                      lineSubtotalCents(item.quantity, item.unit_price_cents),
                      order.currency,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <dl className="grid gap-2 rounded-card border border-border bg-surface px-4 py-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 sm:col-span-2">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular text-ink">{formatMoney(order.subtotal_cents, order.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Tax</dt>
          <dd className="tabular text-ink">{formatMoney(order.tax_cents, order.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Shipping</dt>
          <dd className="tabular text-ink">{formatMoney(order.shipping_cents, order.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Discount</dt>
          <dd className="tabular text-ink">
            {formatMoney(order.discount_cents, order.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 sm:col-span-2">
          <dt className="font-medium text-ink">Total</dt>
          <dd className="tabular font-semibold text-ink">
            {formatMoney(order.total_cents, order.currency)}
          </dd>
        </div>
        {order.return_deadline && (
          <div className="flex justify-between gap-4 sm:col-span-2">
            <dt className="text-ink-muted">Return deadline</dt>
            <dd className="text-ink">{order.return_deadline}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 sm:col-span-2">
          <dt className="text-ink-muted">Source</dt>
          <dd className="text-ink">{order.source.replaceAll('_', ' ')}</dd>
        </div>
      </dl>
    </div>
  );
}
