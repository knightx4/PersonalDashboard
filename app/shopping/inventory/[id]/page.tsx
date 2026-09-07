import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { InventoryImageFallback } from '@/components/inventory/inventory-row';
import { PageHeader } from '@/components/shell/page-header';
import { SendToShare } from '@/components/share/send-to-share';
import { loadShareOptions } from '@/lib/share/load-options';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardSection, cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
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
import { DisposeForm, ItemListsForm, ReturnForm } from './item-forms';
import { BookDetailsPanel } from './book-details-panel';
import { GameDetailsPanel } from './game-details-panel';
import { ItemDetailsPanel } from './item-details-panel';
import { ItemSellPanel } from './sell-panel';
import { CopiesPanel } from './copies-panel';
import { MarkForSaleButton } from './mark-for-sale-button';
import { stackContaining, stackUnits } from '@/lib/inventory/item-groups';

export const metadata = { title: 'Inventory item' };

/** Shape of the copies query above — one row per owned unit. */
type CopyUnitRow = {
  id: string;
  name: string;
  short_name: string | null;
  cost_cents: number;
  acquired_at: string | null;
  fingerprint_loose: string | null;
  group_id: string | null;
  for_sale: boolean;
  return_planned: boolean;
  game_details:
    | { bgg_id: number | null; needs_confirmation: boolean }
    | { bgg_id: number | null; needs_confirmation: boolean }[]
    | null;
  order_items: unknown;
};

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
    { data: gameRow },
  ] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(
        `
        id, name, short_name, variant, notes, status, cost_cents, acquired_at, disposed_at,
        disposal_method, disposal_proceeds_cents, category_id, order_item_id, image_url,
        return_planned, for_sale, source, attributes,
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
    supabase
      .from('game_details')
      .select(
        `
        inventory_item_id, bgg_id, year_published, publisher, min_players, max_players,
        playing_time_minutes, needs_confirmation, match_confidence, resolution_source,
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

  // The other copies of this same item. Everything above is about the item;
  // this is where the boxes differ. See lib/inventory/item-groups.ts.
  const [{ data: unitRows }, { data: groupRows }] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(
        `
        id, name, short_name, cost_cents, acquired_at, fingerprint_loose, group_id,
        for_sale, return_planned,
        game_details ( bgg_id, needs_confirmation ),
        order_items ( orders ( id, deleted_at, merchants ( name ) ) )
      `,
      )
      .eq('user_id', user.id)
      .eq('status', 'owned'),
    supabase.from('item_groups').select('id, name, group_key').eq('user_id', user.id),
  ]);

  const units = ((unitRows ?? []) as unknown as CopyUnitRow[]).map((row) => {
    const game = Array.isArray(row.game_details) ? row.game_details[0] : row.game_details;
    const orderItem = Array.isArray(row.order_items) ? row.order_items[0] : row.order_items;
    const order = orderItem
      ? Array.isArray(orderItem.orders)
        ? orderItem.orders[0]
        : orderItem.orders
      : null;
    const rowMerchant = order
      ? Array.isArray(order.merchants)
        ? order.merchants[0]
        : order.merchants
      : null;
    return {
      inventoryItemId: row.id,
      name: row.name,
      shortName: row.short_name,
      bggId: game?.bgg_id ?? null,
      needsConfirmation: Boolean(game?.needs_confirmation),
      isGame: Boolean(game),
      fingerprintLoose: row.fingerprint_loose,
      groupId: row.group_id,
      costCents: row.cost_cents,
      acquiredAt: row.acquired_at,
      forSale: Boolean(row.for_sale),
      returnPlanned: Boolean(row.return_planned),
      merchantName: rowMerchant?.name ?? null,
      orderId: order?.id ?? null,
    };
  });

  const stack = stackContaining(
    stackUnits(
      units,
      (groupRows ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        groupKey: (row.group_key as string | null) ?? null,
      })),
    ),
    item.id,
  );
  const copies = (stack?.units ?? []).map((unit) => ({
    id: unit.inventoryItemId,
    acquiredAt: unit.acquiredAt,
    costCents: unit.costCents,
    merchantName: unit.merchantName,
    orderId: unit.orderId,
    forSale: unit.forSale,
    returnPlanned: unit.returnPlanned,
  }));

  const attributeValues = parseAttributeValues(item.attributes);
  const attributeTemplate = templateFor({
    categorySlug: category?.slug ?? null,
    savedFields: templateRow?.fields ?? null,
    hasSavedTemplate: Boolean(templateRow),
  });

  // One fact, one place. The board-games template carries Players and Playing
  // time, the books template carries ISBN, and the catalog rows below answer
  // the same three — so the item read "Players 2–6" from the catalog and then
  // offered a second, empty Players box a few lines down. Where the catalog has
  // the answer it keeps it and the field stands down; where it does not, the
  // field is the only place the answer can live, so it is drawn. Stored values
  // are untouched either way: saving merges, so a field that is not rendered
  // keeps whatever it already holds.
  const catalogAnswered = new Map<string, string>();
  if (gameRow) {
    if (gameRow.min_players != null || gameRow.max_players != null) {
      catalogAnswered.set('players', 'Players');
    }
    if (gameRow.playing_time_minutes != null) {
      catalogAnswered.set('playing_time_min', 'Playing time');
    }
  }
  if (bookRow && (bookRow.isbn_13 || bookRow.isbn_10)) {
    catalogAnswered.set('isbn', 'ISBN');
  }
  const attributeFields = fieldsForItem(attributeTemplate, attributeValues).filter(
    (field) => !catalogAnswered.has(field.key),
  );

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
    // A detail page reads top to bottom, so it gets the reading column rather
    // than the single-form width the panels below might suggest.
    <div className="mx-auto max-w-3xl space-y-8">
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

      <Card padding="none" className="overflow-hidden">
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
          <p className="border-t border-border px-4 py-2 text-ui text-ink-muted">
            Full title: <span className="text-ink">{item.name}</span>
          </p>
        )}
      </Card>

      <dl className={cn(cardVariants({ padding: 'dense' }), 'grid gap-3 text-body sm:grid-cols-2')}>
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
                  ? 'font-medium text-caution'
                  : 'text-ink'
              }
            >
              {returnDueCopy}
              {returnDeadline ? (
                <span className="ml-2 text-ink-muted">({returnDeadline})</span>
              ) : null}
              {item.return_planned ? (
                <span className="ml-2 text-micro font-semibold uppercase tracking-wide text-accent">
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
              <Link href={`/shopping/orders/${order.id}`} className="text-accent hover:underline">
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

      <ItemDetailsPanel
        itemId={item.id}
        item={{ name: item.name, variant: item.variant, notes: item.notes }}
        categories={categories ?? []}
        categoryId={item.category_id}
        categoryName={category?.name ?? null}
        template={attributeTemplate}
        fields={attributeFields}
        values={attributeValues}
        searchAvailable={searchProviderFor(category?.slug ?? null) !== null}
        catalogAnsweredLabels={[...catalogAnswered.values()]}
        catalog={
          bookRow || gameRow ? (
            <>
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
                      bookRow.match_confidence != null
                        ? Number(bookRow.match_confidence)
                        : null,
                    resolutionSource: bookRow.resolution_source,
                  }}
                />
              )}
              {gameRow && (
                <GameDetailsPanel
                  game={{
                    inventoryItemId: gameRow.inventory_item_id,
                    title: item.name,
                    imageUrl,
                    bggId: gameRow.bgg_id,
                    yearPublished: gameRow.year_published,
                    publisher: gameRow.publisher,
                    minPlayers: gameRow.min_players,
                    maxPlayers: gameRow.max_players,
                    playingTimeMinutes: gameRow.playing_time_minutes,
                    needsConfirmation: gameRow.needs_confirmation,
                    confirmationReason: gameRow.confirmation_reason ?? null,
                    candidates: Array.isArray(gameRow.candidates) ? gameRow.candidates : [],
                    autoImported: Boolean(gameRow.auto_imported),
                    matchConfidence:
                      gameRow.match_confidence != null
                        ? Number(gameRow.match_confidence)
                        : null,
                    resolutionSource: gameRow.resolution_source,
                  }}
                />
              )}
            </>
          ) : null
        }
      />

      {copies.length > 0 && (
        <CopiesPanel
          copies={copies}
          currentId={item.id}
          groupId={stack?.groupId ?? null}
          derived={!stack?.groupId}
        />
      )}

      {sellQuote && <ItemSellPanel itemId={item.id} quote={sellQuote} />}

      {item.status === 'owned' && (
        <CardSection
          title="Sell this"
          action={<MarkForSaleButton itemId={item.id} forSale={Boolean(item.for_sale)} />}
        >
          <p className="text-ui text-ink-muted">
            Puts it on the{' '}
            <Link href="/shopping/sell" className="text-accent hover:underline">
              sell page
            </Link>
            , whether or not it is something the assistant can price.
          </p>
        </CardSection>
      )}

      {item.status === 'owned' && order && (
        <CardSection
          title="Plan a return"
          action={<PlanReturnButton itemId={item.id} planned={Boolean(item.return_planned)} />}
        >
          <p className="text-ui text-ink-muted">
            Marks this unit on the{' '}
            <Link href="/shopping/returns?view=marked" className="text-accent hover:underline">
              returns tracker
            </Link>{' '}
            without recording a refund yet.
          </p>
        </CardSection>
      )}

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
            <Card padding="dense" className="border-dashed text-body text-ink-muted">
              This owned item is not linked to an order, so it cannot be marked returned.
            </Card>
          )}
          <DisposeForm itemId={item.id} />
        </div>
      )}
    </div>
  );
}
