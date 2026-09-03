import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { InventoryImageFallback } from '@/components/inventory/inventory-row';
import { PageHeader } from '@/components/shell/page-header';
import { SendToShare } from '@/components/share/send-to-share';
import { loadShareOptions } from '@/lib/share/load-options';
import { buttonVariants } from '@/components/ui/button';
import { formatMoney, todayInTimezone } from '@/lib/money';
import { deadlineLabel, daysBetween } from '@/lib/returns/deadline';
import { PlanReturnButton } from '@/app/shopping/returns/plan-return-button';
import { displayVariant } from '@/lib/inventory/display';
import { displayNameOf } from '@/lib/inventory/sort-group';
import { loadItemSellQuote } from '@/lib/sell/item-quote';
import {
  fieldsForItem,
  parseAttributeValues,
  searchProviderFor,
  templateFor,
} from '@/lib/inventory/attributes';
import { DisposeForm, EditInventoryForm, ItemListsForm, ReturnForm } from './item-forms';
import { BookDetailsPanel } from './book-details-panel';
import { ItemAttributesPanel } from './attributes-panel';
import { ItemSellPanel } from './sell-panel';

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
    { data: bookRow },
  ] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(
        `
        id, name, short_name, variant, notes, status, cost_cents, acquired_at, disposed_at,
        disposal_method, disposal_proceeds_cents, category_id, order_item_id, image_url,
        return_planned, source, attributes,
        categories ( id, name, color, slug ),
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
    supabase
      .from('book_details')
      .select(
        `
        inventory_item_id, isbn_13, isbn_10, authors, edition, publisher,
        published_year, condition, needs_confirmation, match_confidence, resolution_source,
        candidates, confirmation_reason, auto_imported
      `,
      )
      .eq('inventory_item_id', id)
      .maybeSingle(),
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
  const imageUrl = item.image_url ?? orderItem?.image_url ?? null;
  const title = displayNameOf({ short_name: item.short_name, name: item.name });
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

  // A template row exists only once the user has edited it; until then the
  // category's built-in fields apply.
  const { data: templateRow } = item.category_id
    ? await supabase
        .from('category_attribute_templates')
        .select('fields')
        .eq('user_id', user.id)
        .eq('category_id', item.category_id)
        .maybeSingle()
    : { data: null };

  const attributeValues = parseAttributeValues(item.attributes);
  const attributeTemplate = templateFor({
    categorySlug: category?.slug ?? null,
    savedFields: templateRow?.fields ?? null,
    hasSavedTemplate: Boolean(templateRow),
  });

  // Only worth asking for something still owned, and it never spends a lookup:
  // the price on screen is whatever is already cached.
  const sellQuote =
    item.status === 'owned'
      ? await loadItemSellQuote({ supabase, userId: user.id, inventoryItemId: item.id })
      : null;

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

  // Offered only while the item is still owned: a form asking whether to keep
  // something already sold wastes the reader's time, and share_page() filters
  // those out anyway.
  const shareOptions =
    item.status === 'owned' ? await loadShareOptions(supabase, user.id) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title={title}
        description={[displayVariant(item.variant), category?.name, item.status]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <SendToShare shares={shareOptions} inventoryItemIds={[item.id]} />
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
              href="/shopping/inventory"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              All inventory
            </Link>
          </div>
        }
      />

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <div className="aspect-[16/9] bg-canvas sm:aspect-[2/1]">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <InventoryImageFallback
              categorySlug={category?.slug}
              className="size-full"
            />
          )}
        </div>
        {item.short_name && item.short_name !== item.name && (
          <p className="border-t border-border px-4 py-2 text-[13px] text-ink-muted">
            Full title: <span className="text-ink">{item.name}</span>
          </p>
        )}
      </div>

      <dl className="grid gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">Landed cost</dt>
          <dd className="tabular font-medium text-ink">{formatMoney(item.cost_cents)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Acquired</dt>
          <dd className="text-ink">{item.acquired_at ?? '—'}</dd>
        </div>
        {item.source && (
          <div>
            <dt className="text-ink-muted">Source</dt>
            <dd className="text-ink">{String(item.source).replace('_', ' ')}</dd>
          </div>
        )}
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
              <Link href={`/shopping/orders/${order.id}`} className="text-brand hover:underline">
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

      {bookRow && (
        <BookDetailsPanel
          book={{
            inventoryItemId: bookRow.inventory_item_id,
            title: item.name,
            imageUrl,
            isbn13: bookRow.isbn_13,
            isbn10: bookRow.isbn_10,
            authors: bookRow.authors ?? [],
            edition: bookRow.edition,
            publisher: bookRow.publisher,
            publishedYear: bookRow.published_year,
            condition: bookRow.condition,
            needsConfirmation: bookRow.needs_confirmation,
            confirmationReason: bookRow.confirmation_reason ?? null,
            candidates: Array.isArray(bookRow.candidates) ? bookRow.candidates : [],
            autoImported: Boolean(bookRow.auto_imported),
            matchConfidence:
              bookRow.match_confidence != null ? Number(bookRow.match_confidence) : null,
            resolutionSource: bookRow.resolution_source,
          }}
        />
      )}

      <ItemAttributesPanel
        itemId={item.id}
        categoryId={item.category_id}
        categoryName={category?.name ?? null}
        template={attributeTemplate}
        fields={fieldsForItem(attributeTemplate, attributeValues)}
        values={attributeValues}
        searchAvailable={searchProviderFor(category?.slug ?? null) !== null}
      />

      {sellQuote && <ItemSellPanel itemId={item.id} quote={sellQuote} />}

      {item.status === 'owned' && order && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Plan a return</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Marks this unit on the{' '}
              <Link href="/shopping/returns?view=marked" className="text-brand hover:underline">
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
          {item.order_item_id ? (
            <ReturnForm itemId={item.id} defaultRefundCents={item.cost_cents} />
          ) : (
            <div className="rounded-card border border-dashed border-border bg-surface p-4 text-sm text-ink-muted">
              This owned item is not linked to an order, so it cannot be marked returned.
            </div>
          )}
          <DisposeForm itemId={item.id} />
        </div>
      )}
    </div>
  );
}
