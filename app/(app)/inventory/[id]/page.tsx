import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { formatMoney, todayInTimezone } from '@/lib/money';
import { deadlineLabel, daysBetween } from '@/lib/returns/deadline';
import { PlanReturnButton } from '@/app/(app)/returns/plan-return-button';
import { DisposeForm, EditInventoryForm, ItemListsForm, ReturnForm } from './item-forms';

export const metadata = { title: 'Inventory item' };

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { id } = await params;

  const [
    { data: item },
    { data: categories },
    { data: lists },
    { data: memberships },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(
        `
        id, name, variant, notes, status, cost_cents, acquired_at, disposed_at,
        disposal_method, disposal_proceeds_cents, category_id, order_item_id, image_url,
        return_planned,
        categories ( id, name, color ),
        order_items (
          order_id, product_url, image_url,
          orders (
            id, external_order_number, return_deadline, status, merchant_id,
            merchants ( id, name, default_return_window_days )
          )
        )
      `,
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('categories')
      .select('id, name')
      .is('parent_id', null)
      .order('name'),
    supabase
      .from('item_lists')
      .select('id, name, color')
      .eq('user_id', user.id)
      .order('name'),
    supabase
      .from('inventory_item_lists')
      .select('list_id')
      .eq('inventory_item_id', id),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  if (!item) notFound();

  const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
  const orderItem = Array.isArray(item.order_items) ? item.order_items[0] : item.order_items;
  const order = orderItem
    ? Array.isArray(orderItem.orders)
      ? orderItem.orders[0]
      : orderItem.orders
    : null;
  const merchant = order
    ? Array.isArray(order.merchants)
      ? order.merchants[0]
      : order.merchants
    : null;
  const productUrl = orderItem?.product_url ?? null;
  const selectedListIds = (memberships ?? []).map((row) => row.list_id as string);

  const timezone = profile?.timezone ?? 'UTC';
  const today = todayInTimezone(timezone);
  const returnDeadline = order?.return_deadline ?? null;
  const daysLeft = returnDeadline ? daysBetween(today, returnDeadline) : null;

  let hasReturnWindow = merchant?.default_return_window_days != null;
  if (order?.merchant_id) {
    const { data: override } = await supabase
      .from('merchant_return_policies')
      .select('return_window_days')
      .eq('user_id', user.id)
      .eq('merchant_id', order.merchant_id)
      .maybeSingle();
    if (override) {
      hasReturnWindow = override.return_window_days != null;
    }
  }

  let returnDueCopy: string | null = null;
  if (item.status === 'owned' && order) {
    if (returnDeadline && daysLeft != null) {
      returnDueCopy = deadlineLabel(daysLeft, returnDeadline);
    } else if (!hasReturnWindow) {
      returnDueCopy = 'No return window set for this merchant';
    } else {
      returnDueCopy = 'Awaiting delivery for deadline';
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title={item.name}
        description={[item.variant, category?.name, item.status].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            {productUrl && (
              <a
                href={productUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                View product
              </a>
            )}
            <Link
              href="/inventory"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              All inventory
            </Link>
          </div>
        }
      />

      <dl className="grid gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">Landed cost</dt>
          <dd className="tabular font-medium text-ink">{formatMoney(item.cost_cents)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Acquired</dt>
          <dd className="text-ink">{item.acquired_at ?? '—'}</dd>
        </div>
        {returnDueCopy && (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">Return due</dt>
            <dd
              className={
                daysLeft != null && daysLeft <= 7
                  ? 'font-medium text-accent-orange'
                  : 'text-ink'
              }
            >
              {returnDueCopy}
              {returnDeadline ? (
                <span className="ml-2 text-ink-muted">({returnDeadline})</span>
              ) : null}
              {item.return_planned ? (
                <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
                  To return
                </span>
              ) : null}
            </dd>
          </div>
        )}
        {order && (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">From order</dt>
            <dd>
              <Link href={`/orders/${order.id}`} className="text-brand hover:underline">
                {merchant?.name ?? 'Order'}
                {order.external_order_number ? ` · #${order.external_order_number}` : ''}
              </Link>
            </dd>
          </div>
        )}
        {item.disposed_at && (
          <>
            <div>
              <dt className="text-ink-muted">Disposed</dt>
              <dd className="text-ink">
                {item.disposed_at}
                {item.disposal_method ? ` · ${item.disposal_method}` : ''}
              </dd>
            </div>
            {item.disposal_proceeds_cents != null && (
              <div>
                <dt className="text-ink-muted">Proceeds</dt>
                <dd className="tabular text-ink">
                  {formatMoney(item.disposal_proceeds_cents)}
                </dd>
              </div>
            )}
          </>
        )}
      </dl>

      {item.status === 'owned' && order && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Plan a return</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Marks this unit on the{' '}
              <Link href="/returns?view=marked" className="text-brand hover:underline">
                returns tracker
              </Link>{' '}
              without recording a refund yet.
            </p>
          </div>
          <PlanReturnButton itemId={item.id} planned={Boolean(item.return_planned)} />
        </section>
      )}

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-4 text-sm font-semibold text-ink">Edit</h2>
        <EditInventoryForm
          item={{
            id: item.id,
            name: item.name,
            variant: item.variant,
            categoryId: item.category_id,
            notes: item.notes,
          }}
          categories={categories ?? []}
        />
      </section>

      <ItemListsForm
        itemId={item.id}
        lists={lists ?? []}
        selectedListIds={selectedListIds}
      />

      {item.status === 'owned' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReturnForm itemId={item.id} defaultRefundCents={item.cost_cents} />
          <DisposeForm itemId={item.id} />
        </div>
      )}
    </div>
  );
}
