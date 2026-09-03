'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  estimateMissingPrices,
  importBooksFromOrders,
  noteListingIntent,
  setManualGamePrice,
  setManualPrice,
  testEbayConnection,
  updateSellSettings,
  type EbayCheckState,
  type SellActionState,
} from './actions';
import {
  confirmBookEdition,
  switchBookEdition,
  type BookActionState,
} from '@/app/shopping/inventory/add/actions';
import {
  disposeInventoryItem,
  setItemsForSale,
  type ActionState,
} from '@/app/shopping/inventory/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import { formatCentsAsDollarsInput, formatMoney } from '@/lib/money';
import type { SellBookRow, SellPendingRow } from '@/lib/sell/load';
import type { SellGameRow } from '@/lib/sell/load-games';
import type { SellMarkedRow } from '@/lib/sell/load-marked';
import type { SellPath } from '@/lib/sell/route';

const PATH_LABEL: Record<SellPath, string> = {
  list_individually: 'List individually',
  lot: 'Lot together',
  buyback: 'Buyback vendor',
  donate: 'Donate',
};

function SellRowActions({ row }: { row: SellBookRow }) {
  const [priceState, priceAction, pricePending] = useActionState(
    setManualPrice,
    {} as SellActionState,
  );
  const [disposeState, disposeAction, disposePending] = useActionState(
    disposeInventoryItem,
    {} as ActionState,
  );
  const [noteState, noteAction, notePending] = useActionState(
    noteListingIntent,
    {} as SellActionState,
  );

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {row.path === 'buyback' && row.buyback?.url && (
        <a
          href={row.buyback.url}
          target="_blank"
          rel="noreferrer"
          className="text-[13px] text-brand underline"
        >
          Open {row.buyback.vendor}
        </a>
      )}
      <form action={priceAction} className="flex items-end gap-2">
        <input type="hidden" name="inventory_item_id" value={row.inventoryItemId} />
        <Input
          name="price"
          defaultValue={
            row.priceIsManual && row.expectedSelfListCents != null
              ? formatCentsAsDollarsInput(row.expectedSelfListCents)
              : ''
          }
          placeholder="Own price"
          className="w-24"
          aria-label="Price you found yourself"
        />
        <Button type="submit" size="sm" variant="ghost" disabled={pricePending}>
          {pricePending ? 'Saving…' : 'Set'}
        </Button>
      </form>
      {(row.path === 'list_individually' || row.path === 'lot') && (
        <form action={noteAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="note" value={`Sell assistant: ${PATH_LABEL[row.path]}`} />
          <Button type="submit" size="sm" variant="secondary" disabled={notePending}>
            I’ll list this myself
          </Button>
        </form>
      )}
      {row.path === 'donate' && (
        <form action={disposeAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="disposal_method" value="donated" />
          <input type="hidden" name="disposal_proceeds" value="" />
          <Button type="submit" size="sm" variant="secondary" disabled={disposePending}>
            Mark donated
          </Button>
        </form>
      )}
      {row.path === 'buyback' && (
        <form action={disposeAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="disposal_method" value="sold" />
          <input
            type="hidden"
            name="disposal_proceeds"
            value={
              row.netBuybackCents != null
                ? formatCentsAsDollarsInput(row.netBuybackCents)
                : ''
            }
          />
          <Button type="submit" size="sm" disabled={disposePending}>
            Mark sold to buyback
          </Button>
        </form>
      )}
      <FieldError>{disposeState.error ?? noteState.error ?? priceState.error}</FieldError>
      {(disposeState.message || noteState.message) && (
        <p className="w-full text-[13px] text-brand">
          {disposeState.message ?? noteState.message}
        </p>
      )}
    </div>
  );
}

export function SellSettingsForm({
  netFloorCents,
  effortCents,
}: {
  netFloorCents: number;
  effortCents: number;
}) {
  const [state, action, pending] = useActionState(updateSellSettings, {} as SellActionState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
      <div>
        <Label htmlFor="net_floor">Net floor ($)</Label>
        <Input
          id="net_floor"
          name="net_floor"
          defaultValue={formatCentsAsDollarsInput(netFloorCents)}
          className="w-28"
        />
      </div>
      <div>
        <Label htmlFor="effort">Effort cost ($)</Label>
        <Input
          id="effort"
          name="effort"
          defaultValue={formatCentsAsDollarsInput(effortCents)}
          className="w-28"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Update'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-brand">{state.message}</p>}
    </form>
  );
}

export function SellPathGroup({
  path,
  rows,
}: {
  path: SellPath;
  rows: SellBookRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">
        {PATH_LABEL[path]}{' '}
        <span className="font-normal text-ink-muted">({rows.length})</span>
      </h2>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.inventoryItemId} className="flex gap-3 px-4 py-3">
            {row.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.imageUrl}
                alt=""
                className="h-16 w-12 shrink-0 rounded object-cover bg-canvas"
              />
            ) : (
              <div className="h-16 w-12 shrink-0 rounded bg-canvas" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={`/shopping/inventory/${row.inventoryItemId}`}
                className="font-medium text-ink hover:underline"
              >
                {row.shortName || row.name}
              </Link>
              <p className="text-[13px] text-ink-muted">
                {row.authors.join(', ')}
                {row.isbn13 ? ` · ${row.isbn13}` : ''}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">{row.reason}</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                {row.netSelfCents != null && (
                  <span className="mr-3">
                    Self net {formatMoney(row.netSelfCents)}
                    {row.priceIsManual ? ' (your price)' : ''}
                  </span>
                )}
                {row.netBuybackCents != null && (
                  <span className="mr-3">Buyback net {formatMoney(row.netBuybackCents)}</span>
                )}
                {row.path === 'donate' && row.donateFmvCents > 0 && (
                  <span>FMV hint {formatMoney(row.donateFmvCents)} (not tax advice)</span>
                )}
              </p>
              <SellRowActions row={row} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}


function editionLine(row: {
  edition: string | null;
  publisher: string | null;
  publishedYear: number | null;
}): string {
  const parts = [row.edition, row.publisher, row.publishedYear].filter(Boolean).map(String);
  return parts.length > 0 ? parts.join(' · ') : 'Edition not stated by the catalog';
}

function PendingBookRow({ row }: { row: SellPendingRow }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBookEdition,
    {} as BookActionState,
  );
  const [switchState, switchAction, switchPending] = useActionState(
    switchBookEdition,
    {} as BookActionState,
  );

  return (
    <li className="flex gap-3 px-4 py-3">
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary catalog CDNs
        <img
          src={row.imageUrl}
          alt=""
          className="h-16 w-12 shrink-0 rounded object-cover bg-canvas"
        />
      ) : (
        <div className="h-16 w-12 shrink-0 rounded bg-canvas" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/shopping/inventory/${row.inventoryItemId}`}
          className="font-medium text-ink hover:underline"
        >
          {row.title}
        </Link>
        {row.authors.length > 0 && (
          <p className="text-[13px] text-ink-muted">{row.authors.join(', ')}</p>
        )}
        <p className="text-[13px] text-ink-faint">
          {editionLine(row)}
          {row.isbn13 ? ` · ISBN ${row.isbn13}` : ' · no ISBN yet'}
        </p>
        <p className="mt-1 text-[12px] text-ink-muted">
          {row.confirmationReason ??
            'More than one printing matches this title, and buyback quotes are per ISBN.'}
          {row.autoImported ? ' Imported from an order email.' : ''}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={confirmAction}>
            <input type="hidden" name="inventory_item_id" value={row.inventoryItemId} />
            <Button type="submit" size="sm" disabled={confirmPending}>
              {confirmPending ? 'Saving…' : 'This edition is right'}
            </Button>
          </form>
          {row.candidates.slice(0, 2).map((candidate, index) => (
            <form action={switchAction} key={candidate.isbn13 ?? `${candidate.title}-${index}`}>
              <input type="hidden" name="inventory_item_id" value={row.inventoryItemId} />
              <input type="hidden" name="candidate_json" value={JSON.stringify(candidate)} />
              <Button type="submit" size="sm" variant="secondary" disabled={switchPending}>
                {[candidate.publisher, candidate.publishedYear].filter(Boolean).join(' ') ||
                  candidate.title}
              </Button>
            </form>
          ))}
          {row.candidates.length > 2 && (
            <Link
              href={`/shopping/inventory/${row.inventoryItemId}`}
              className="text-[13px] text-brand hover:underline"
            >
              {row.candidates.length - 2} more printing(s)
            </Link>
          )}
        </div>
        <FieldError>{confirmState.error ?? switchState.error}</FieldError>
      </div>
    </li>
  );
}

export function SellConfirmQueue({ rows }: { rows: SellPendingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Confirm the edition{' '}
          <span className="font-normal text-ink-muted">({rows.length})</span>
        </h2>
        <p className="text-[13px] text-ink-muted">
          Price follows the printing, so these sit out of routing until you pick one.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <PendingBookRow key={row.inventoryItemId} row={row} />
        ))}
      </ul>
    </section>
  );
}

/** Pull books out of orders that were imported before book detection existed. */
export function ImportBooksFromOrdersButton() {
  const [state, action, pending] = useActionState(
    importBooksFromOrders,
    {} as SellActionState,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Scanning orders…' : 'Scan past orders for books'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-brand">{state.message}</p>}
    </form>
  );
}



/**
 * Run one live eBay lookup and show what came back.
 *
 * The credentials live in a hosting dashboard and are used by a deployed app,
 * so "are they working" was previously answerable only by reading server logs.
 * This asks, on the page where the answer matters.
 */
export function TestEbayConnectionButton() {
  const [state, action, pending] = useActionState(
    testEbayConnection,
    {} as EbayCheckState,
  );
  const result = state.result;

  // A failure that is only about the searched book still means the wiring
  // works, so it is not painted as an error.
  const failed = result ? !result.ok && result.stage !== 'no_results' : false;

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Testing…' : 'Test eBay connection'}
        </Button>
        <span className="text-[13px] text-ink-muted">
          Runs one live lookup. Free — Browse is not billed per call.
        </span>
      </div>

      {result && (
        <div
          className={
            'rounded-lg border px-3 py-2 text-[13px] ' +
            (result.ok
              ? 'border-green-200 bg-green-50 text-green-900'
              : failed
                ? 'border-red-200 bg-red-50 text-red-900'
                : 'border-border bg-surface text-ink')
          }
        >
          <p className="font-medium">
            {result.ok ? '✓ ' : failed ? '✗ ' : ''}
            {result.headline}
            {result.priceCents != null && ` · ${formatMoney(result.priceCents)}`}
          </p>
          {/* eBay's own words, so an unfamiliar error is still searchable. */}
          <p className="mt-1 break-words opacity-90">
            {result.stage !== 'ok' && result.stage !== 'unconfigured' && (
              <span className="font-mono text-[12px]">
                [{result.stage}
                {result.status ? ` ${result.status}` : ''}]{' '}
              </span>
            )}
            {result.detail}
          </p>
          {result.hint && <p className="mt-1 opacity-90">{result.hint}</p>}
        </div>
      )}
    </form>
  );
}

/**
 * Billed price lookups, run only on request. The label says how many books
 * and roughly what it costs, because the click spends money.
 */
export function EstimatePricesButton({
  unpricedCount,
  pricedCount,
  batchLimit,
  paid,
}: {
  unpricedCount: number;
  /** Books that already have a price, and so can only be *re*-priced. */
  pricedCount: number;
  batchLimit: number;
  paid: boolean;
}) {
  const [state, action, pending] = useActionState(
    estimateMissingPrices,
    {} as SellActionState,
  );
  if (unpricedCount === 0 && pricedCount === 0) return null;

  const thisRun = Math.min(unpricedCount, batchLimit);
  const rescanRun = Math.min(unpricedCount + pricedCount, batchLimit);
  const cost = (books: number) =>
    paid ? ` · about ${formatMoney(Math.ceil(books * 2.5))} of API usage` : '';

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {unpricedCount > 0 && (
        <>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Pricing…' : `Estimate prices for ${thisRun} book(s)`}
          </Button>
          <span className="text-[13px] text-ink-muted">
            {unpricedCount} unpriced
            {cost(thisRun)}
            {unpricedCount > batchLimit ? ' · run again for the rest' : ''}
          </span>
        </>
      )}

      {/*
        Prices go stale and lookups come back empty, so "already priced" cannot
        be the end of it. This submit carries rescan=1, which makes the action
        ignore the cache and ask again.
      */}
      {pricedCount > 0 && (
        <>
          <Button
            type="submit"
            name="rescan"
            value="1"
            size="sm"
            variant="secondary"
            disabled={pending}
          >
            {pending ? 'Pricing…' : `Rescan ${rescanRun} book(s)`}
          </Button>
          <span className="text-[13px] text-ink-muted">
            fetches fresh prices, ignoring what is cached{cost(rescanRun)}
          </span>
        </>
      )}

      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-brand">{state.message}</p>}
    </form>
  );
}

/**
 * Games grouped by the same sell path as books.
 *
 * A separate component rather than a widened SellPathGroup: the subtitle is a
 * year and publisher rather than authors and an ISBN, there is no buyback row
 * to render because nothing buys board games back, and the manual price writes
 * to a different table.
 */
export function SellGamePathGroup({
  path,
  rows,
}: {
  path: SellPath;
  rows: SellGameRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">
        {PATH_LABEL[path]} <span className="font-normal text-ink-muted">({rows.length})</span>
      </h2>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.inventoryItemId} className="flex gap-3 px-4 py-3">
            {row.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.imageUrl}
                alt=""
                className="h-16 w-12 shrink-0 rounded object-cover bg-canvas"
              />
            ) : (
              <div className="h-16 w-12 shrink-0 rounded bg-canvas" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={`/shopping/inventory/${row.inventoryItemId}`}
                className="font-medium text-ink hover:underline"
              >
                {row.shortName || row.name}
              </Link>
              <p className="text-[13px] text-ink-muted">
                {[row.publisher, row.yearPublished].filter(Boolean).join(' · ') ||
                  'Board game'}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">{row.reason}</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                {row.netSelfCents != null && (
                  <span className="mr-3">
                    Self net {formatMoney(row.netSelfCents)}
                    {row.priceIsManual ? ' (your price)' : ''}
                  </span>
                )}
                {row.path === 'donate' && row.donateFmvCents > 0 && (
                  <span>FMV hint {formatMoney(row.donateFmvCents)} (not tax advice)</span>
                )}
              </p>
              <SellGameRowActions row={row} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SellGameRowActions({ row }: { row: SellGameRow }) {
  const [priceState, priceAction, pricePending] = useActionState(
    setManualGamePrice,
    {} as SellActionState,
  );
  const [disposeState, disposeAction, disposePending] = useActionState(
    disposeInventoryItem,
    {} as ActionState,
  );
  const [noteState, noteAction, notePending] = useActionState(
    noteListingIntent,
    {} as SellActionState,
  );

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <form action={priceAction} className="flex items-end gap-2">
        <input type="hidden" name="inventory_item_id" value={row.inventoryItemId} />
        <Input
          name="price"
          defaultValue={
            row.priceIsManual && row.expectedSelfListCents != null
              ? formatCentsAsDollarsInput(row.expectedSelfListCents)
              : ''
          }
          placeholder="Own price"
          className="w-24"
          aria-label="Price you found yourself"
        />
        <Button type="submit" size="sm" variant="ghost" disabled={pricePending}>
          {pricePending ? 'Saving…' : 'Set'}
        </Button>
      </form>
      {(row.path === 'list_individually' || row.path === 'lot') && (
        <form action={noteAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="note" value={`Sell assistant: ${PATH_LABEL[row.path]}`} />
          <Button type="submit" size="sm" variant="secondary" disabled={notePending}>
            I’ll list this myself
          </Button>
        </form>
      )}
      {row.path === 'donate' && (
        <form action={disposeAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="disposal_method" value="donated" />
          <input type="hidden" name="disposal_proceeds" value="" />
          <Button type="submit" size="sm" variant="secondary" disabled={disposePending}>
            Mark donated
          </Button>
        </form>
      )}
      <FieldError>{priceState.error ?? disposeState.error ?? noteState.error}</FieldError>
    </div>
  );
}

/**
 * What the user flagged for sale themselves.
 *
 * No routing and no price: the router needs an identity, and these rows are
 * exactly the ones that do not have one. What this section owes them is to
 * exist — a flag that quietly went nowhere would be worse than no flag — and
 * to be easy to take back off.
 */
export function SellMarkedGroup({ rows }: { rows: SellMarkedRow[] }) {
  const [state, action, pending] = useActionState(setItemsForSale, {} as ActionState);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Marked for sale <span className="font-normal text-ink-muted">({rows.length})</span>
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Flagged by you from inventory. Anything the assistant can price is routed above as
          well — these are listed here so the flag always leads somewhere.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.inventoryItemId} className="flex items-center gap-3 px-4 py-3">
            {row.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
              <img
                src={row.imageUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded bg-canvas object-cover"
              />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded bg-canvas" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={`/shopping/inventory/${row.inventoryItemId}`}
                className="font-medium text-ink hover:underline"
              >
                {row.shortName || row.name}
              </Link>
              <p className="text-[13px] text-ink-muted">
                {row.categoryName ?? 'Uncategorized'} · paid {formatMoney(row.costCents)}
                {row.routedElsewhere ? ' · routed above' : ''}
              </p>
            </div>
            <form action={action}>
              <input type="hidden" name="id" value={row.inventoryItemId} />
              <input type="hidden" name="for_sale" value="false" />
              <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                Unmark
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <FieldError>{state.error}</FieldError>
    </section>
  );
}
