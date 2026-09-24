'use client';

import { useState, useActionState, useRef } from 'react';
import Link from 'next/link';
import {
  noteListingIntent,
  priceSellItems,
  setSellPrice,
  testEbayConnection,
  updateSellSettings,
  type EbayCheckState,
  type SellActionState,
} from './actions';
import {
  disposeInventoryItem,
  setItemsForSale,
  type ActionState,
} from '@/app/shopping/inventory/actions';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FieldError, InlineInput, Input } from '@/components/ui/field';
import { formatCentsAsDollarsInput, formatMoney } from '@/lib/money';
import type { SellQueueRow } from '@/lib/sell/load-for-sale';
import type { SellPath } from '@/lib/sell/route';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { PaidHint } from '@/components/ui/paid-hint';

const PRICE_HINT = 'app/shopping/sell/actions.ts#priceSellItems';

const PATH_LABEL: Record<SellPath, string> = {
  list_individually: 'List individually',
  lot: 'Lot together',
  buyback: 'Buyback vendor',
  donate: 'Donate',
};

/**
 * The order the page reads in: what needs a price first, then what is worth
 * the most effort, and donating last — it is where things go when selling them
 * is not worth it, so it belongs at the bottom rather than mixed in.
 */
const GROUPS: { key: SellPath | 'unpriced'; title: string; note: string | null }[] = [
  {
    key: 'unpriced',
    title: 'No price yet',
    note: 'Nothing is routed without a price. Price these and they sort themselves.',
  },
  { key: 'list_individually', title: 'List individually', note: null },
  { key: 'lot', title: 'Lot together', note: null },
  { key: 'buyback', title: 'Buyback vendor', note: null },
];

/**
 * The two numbers the router runs on, edited where they are read.
 *
 * This was a card holding two labelled fields and an Update button, and
 * directly under it the page printed “Floor $15.00 · Effort $5.00” — the same
 * two values a second time, because the form was not a readable statement of
 * them. That is law 12 exactly: a form about the thing standing in front of
 * the thing. One line now, and the line is the editor.
 *
 * Blur commits, and only when the value actually changed; Escape puts it back.
 * Safe here for the same reasons it is safe on a return window: two
 * independent dollar amounts, both reversible from the same line, and no
 * half-valid state that could be saved by accident. Both fields are in the one
 * form, so committing either sends the pair the action expects.
 */
export function SellSettingsForm({
  netFloorCents,
  effortCents,
}: {
  netFloorCents: number;
  effortCents: number;
}) {
  const [state, action, pending] = useActionState(updateSellSettings, {} as SellActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const floor = formatCentsAsDollarsInput(netFloorCents);
  const effort = formatCentsAsDollarsInput(effortCents);

  const commit = (committed: string) => (event: React.FocusEvent<HTMLInputElement>) => {
    if (event.target.value.trim() !== committed) formRef.current?.requestSubmit();
  };

  const revertOnEscape =
    (committed: string) => (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.currentTarget.value = committed;
        event.currentTarget.blur();
      }
    };

  return (
    <form ref={formRef} action={action} className="space-y-1">
      {/* The field is pulled back over its own inset so the number sits
          against the currency at rest — “Floor $15.00”, a sentence — and the
          inset comes back as the hover box the moment it is pointed at. */}
      <p className="flex flex-wrap items-center text-body text-ink-muted">
        <span>Floor&nbsp;$</span>
        <InlineInput
          name="net_floor"
          inputMode="decimal"
          aria-label="Net floor, in dollars — nothing below this is worth listing"
          defaultValue={floor}
          key={`floor-${floor}`}
          onBlur={commit(floor)}
          onKeyDown={revertOnEscape(floor)}
          disabled={pending}
          className="tabular -ml-1 w-16 font-medium text-ink"
        />
        <span className="ml-3">·&nbsp;Effort&nbsp;$</span>
        <InlineInput
          name="effort"
          inputMode="decimal"
          aria-label="Effort cost per listing, in dollars"
          defaultValue={effort}
          key={`effort-${effort}`}
          onBlur={commit(effort)}
          onKeyDown={revertOnEscape(effort)}
          disabled={pending}
          className="tabular -ml-1 w-16 font-medium text-ink"
        />
        {pending && <span className="ml-3 text-small">Saving…</span>}
      </p>
      <FieldError>{state.error}</FieldError>
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
  const [state, action, pending] = useActionState(testEbayConnection, {} as EbayCheckState);
  const result = state.result;

  // A failure that is only about the searched item still means the wiring
  // works, so it is not painted as an error.
  const failed = result ? !result.ok && result.stage !== 'no_results' : false;

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Testing…' : 'Test eBay connection'}
        </Button>
        <span className="text-ui text-ink-muted">
          Runs one live lookup. Free — Browse is not billed per call.
        </span>
      </div>

      {result && (
        <Banner tone={failed ? 'bad' : 'info'}>
          <p className="font-medium">
            {result.headline}
            {result.priceCents != null && ` · ${formatMoney(result.priceCents)}`}
          </p>
          {/* eBay's own words, so an unfamiliar error is still searchable. */}
          <p className="mt-1 break-words opacity-90">
            {result.stage !== 'ok' && result.stage !== 'unconfigured' && (
              <span className="font-mono text-small">
                [{result.stage}
                {result.status ? ` ${result.status}` : ''}]{' '}
              </span>
            )}
            {result.detail}
          </p>
          {result.hint && <p className="mt-1 opacity-90">{result.hint}</p>}
        </Banner>
      )}
    </form>
  );
}

function priceLine(row: SellQueueRow): string | null {
  if (row.expectedSelfListCents == null) return null;
  const source = row.priceIsManual
    ? ' (your price)'
    : row.priceIsStale
      ? ' (stale — price it again)'
      : '';
  return `Asking ${formatMoney(row.expectedSelfListCents)}${source}`;
}

/**
 * One row's own buttons.
 *
 * Everything on this page can be priced, so "Price now" is unconditional; what
 * varies is only the disposal the router is suggesting.
 */
function RowActions({
  row,
  priceAction,
  pricePending,
}: {
  row: SellQueueRow;
  priceAction: (formData: FormData) => void;
  pricePending: boolean;
}) {
  const [manualState, manualAction, manualPending] = useActionState(
    setSellPrice,
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
  const [unmarkState, unmarkAction, unmarkPending] = useActionState(
    setItemsForSale,
    {} as ActionState,
  );

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <form action={priceAction}>
        <input type="hidden" name="ids" value={row.inventoryItemId} />
        <Button type="submit" size="sm" disabled={pricePending}>
          {pricePending ? 'Pricing…' : 'Price now'}
        </Button>
      </form>

      <form action={manualAction} className="flex items-end gap-2">
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
        <Button type="submit" size="sm" variant="ghost" disabled={manualPending}>
          {manualPending ? 'Saving…' : 'Set'}
        </Button>
      </form>

      {row.path === 'buyback' && row.buyback?.url && (
        <a
          href={row.buyback.url}
          target="_blank"
          rel="noreferrer"
          className="self-center text-ui text-accent underline"
        >
          Open {row.buyback.vendor}
        </a>
      )}

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

      {/* The flag is what put the row here, so taking it off belongs here too. */}
      <form action={unmarkAction}>
        <input type="hidden" name="id" value={row.inventoryItemId} />
        <input type="hidden" name="for_sale" value="false" />
        <Button type="submit" size="sm" variant="ghost" disabled={unmarkPending}>
          Not for sale
        </Button>
      </form>

      <FieldError>
        {manualState.error ?? disposeState.error ?? noteState.error ?? unmarkState.error}
      </FieldError>
      {(disposeState.message || noteState.message || manualState.message) && (
        <p className="w-full text-ui text-accent">
          {disposeState.message ?? noteState.message ?? manualState.message}
        </p>
      )}
    </div>
  );
}

function SellRow({
  row,
  checked,
  onToggle,
  priceAction,
  pricePending,
}: {
  row: SellQueueRow;
  checked: boolean;
  onToggle: (id: string) => void;
  priceAction: (formData: FormData) => void;
  pricePending: boolean;
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(row.inventoryItemId)}
        aria-label={`Select ${row.shortName || row.name}`}
        className="mt-1 size-4 shrink-0 rounded border-border text-accent focus:ring-accent/30"
      />
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
        <img
          src={row.imageUrl}
          alt=""
          className="h-16 w-12 shrink-0 rounded bg-canvas object-cover"
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
        {row.subtitle && <p className="text-ui text-ink-muted">{row.subtitle}</p>}

        <p className="mt-1 text-ui text-ink-muted">
          {priceLine(row) ?? 'No price yet'}
          {row.netSelfCents != null && (
            <span className="ml-3">Self net {formatMoney(row.netSelfCents)}</span>
          )}
          {row.netBuybackCents != null && (
            <span className="ml-3">Buyback net {formatMoney(row.netBuybackCents)}</span>
          )}
          {row.path === 'donate' && row.donateFmvCents > 0 && (
            <span className="ml-3">
              FMV hint {formatMoney(row.donateFmvCents)} (not tax advice)
            </span>
          )}
        </p>

        {row.reason && <p className="mt-1 text-small text-ink-muted">{row.reason}</p>}

        {row.needsConfirmation && (
          <p className="mt-1 text-small text-ink-muted">
            Edition not confirmed, so this is priced on its title —{' '}
            <Link
              href={`/shopping/inventory/${row.inventoryItemId}`}
              className="underline underline-offset-2 hover:text-accent"
            >
              confirm it
            </Link>{' '}
            for an exact match.
          </p>
        )}

        <RowActions row={row} priceAction={priceAction} pricePending={pricePending} />
      </div>
    </li>
  );
}

/**
 * Everything marked for sale, priced and routed.
 *
 * One list rather than a section per catalog: what the page is about is the
 * flag, and an item that happens to have an ISBN is not a different kind of
 * thing to deal with. Selection lives here because "price these three" is a
 * question about the list, not about any one row.
 */
export function SellQueue({
  rows,
  unpricedCount,
  batchLimit,
  paid,
  hasPriceSource,
}: {
  rows: SellQueueRow[];
  unpricedCount: number;
  batchLimit: number;
  /** True when each lookup is billed, so the buttons say what a click costs. */
  paid: boolean;
  hasPriceSource: boolean;
}) {
  const [state, priceAction, pricePending] = useActionState(
    priceSellItems,
    {} as SellActionState,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A row can leave the list between renders (unmarked, or disposed), and a
  // stale id in the selection would be priced invisibly.
  const present = new Set(rows.map((r) => r.inventoryItemId));
  const selectedIds = [...selected].filter((id) => present.has(id));

  // Only a web estimate is billed; a catalog lookup costs nothing.
  const hint = (count: number, what: string) =>
    paid ? <PaidHint action={PRICE_HINT} count={count} what={what} /> : null;
  const thisRun = Math.min(unpricedCount, batchLimit);

  const donate = rows.filter((r) => r.path === 'donate');

  return (
    <div className="space-y-6">
      {hasPriceSource && (
        <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
          <div className="flex flex-wrap items-center gap-2">
            {unpricedCount > 0 && (
              <form action={priceAction}>
                <Button type="submit" size="sm" disabled={pricePending}>
                  {pricePending ? 'Pricing…' : `Price all ${thisRun} unpriced`}
                </Button>
              </form>
            )}
            {unpricedCount > 0 && hint(thisRun, 'Cost of pricing the unpriced')}

            <form action={priceAction}>
              <input type="hidden" name="ids" value={selectedIds.join(',')} />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={pricePending || selectedIds.length === 0}
              >
                {`Price ${selectedIds.length} selected`}
              </Button>
            </form>
            {selectedIds.length > 0 && hint(selectedIds.length, 'Cost of pricing the selected')}

            {/* Prices go stale and lookups come back empty, so "already priced"
                cannot be the end of it. */}
            <form action={priceAction}>
              <input type="hidden" name="rescan" value="1" />
              <Button type="submit" size="sm" variant="ghost" disabled={pricePending}>
                Rescan everything
              </Button>
            </form>
            {hint(Math.min(rows.length, batchLimit), 'Cost of the rescan')}

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setSelected(
                  selectedIds.length === rows.length
                    ? new Set()
                    : new Set(rows.map((r) => r.inventoryItemId)),
                )
              }
            >
              {selectedIds.length === rows.length ? 'Clear selection' : 'Select all'}
            </Button>
          </div>

          <p className="text-ui text-ink-muted">
            {unpricedCount} of {rows.length} have no price
            {unpricedCount > batchLimit ? ' · one run covers ' + batchLimit : ''}
          </p>

          <FieldError>{state.error}</FieldError>
          {state.message && <p className="text-ui text-accent">{state.message}</p>}
        </div>
      )}

      {GROUPS.map((group) => {
        const groupRows = rows.filter((r) =>
          group.key === 'unpriced' ? r.path === null : r.path === group.key,
        );
        if (groupRows.length === 0) return null;
        return (
          <section key={group.key} className="space-y-3">
            <div>
              <h2 className="text-body font-semibold text-ink">
                {group.title}{' '}
                <span className="font-normal text-ink-muted">({groupRows.length})</span>
              </h2>
              {group.note && <p className="text-ui text-ink-muted">{group.note}</p>}
            </div>
            <ul className={cn(cardVariants(), 'divide-y divide-border')}>
              {groupRows.map((row) => (
                <SellRow
                  key={row.inventoryItemId}
                  row={row}
                  checked={selected.has(row.inventoryItemId)}
                  onToggle={toggle}
                  priceAction={priceAction}
                  pricePending={pricePending}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* Its own section at the bottom: this is the pile that is not worth
          selling, and it should not be the first thing the page shows. */}
      {donate.length > 0 && (
        <section className="space-y-3 border-t border-border pt-6">
          <div>
            <h2 className="text-body font-semibold text-ink">
              Donate <span className="font-normal text-ink-muted">({donate.length})</span>
            </h2>
            <p className="text-ui text-ink-muted">
              Near-zero after fees, shipping and effort — worth more as a donation than as a
              listing. The FMV hint is a rough number, not tax advice.
            </p>
          </div>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {donate.map((row) => (
              <SellRow
                key={row.inventoryItemId}
                row={row}
                checked={selected.has(row.inventoryItemId)}
                onToggle={toggle}
                priceAction={priceAction}
                pricePending={pricePending}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
