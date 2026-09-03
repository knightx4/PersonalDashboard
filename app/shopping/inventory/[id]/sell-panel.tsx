'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  priceOneItem,
  setManualGamePrice,
  setManualPrice,
  type SellActionState,
} from '@/app/shopping/sell/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { formatCentsAsDollarsInput, formatMoney } from '@/lib/money';
import type { ItemSellQuote } from '@/lib/sell/item-quote';
import type { SellPath } from '@/lib/sell/route';

const PATH_LABEL: Record<SellPath, string> = {
  list_individually: 'List individually',
  lot: 'Lot together',
  buyback: 'Buyback vendor',
  donate: 'Donate',
};

const initial: SellActionState = {};

/**
 * What this one item is worth, and the button that finds out.
 *
 * The shelf-wide assistant at /shopping/sell prices everything at once; this
 * answers the same question for the item you are looking at, without making
 * you go and find it in a list.
 */
export function ItemSellPanel({
  itemId,
  quote,
}: {
  itemId: string;
  quote: ItemSellQuote;
}) {
  const [priceState, priceAction, pricePending] = useActionState(priceOneItem, initial);
  const [manualState, manualAction, manualPending] = useActionState(
    quote.kind === 'game' ? setManualGamePrice : setManualPrice,
    initial,
  );

  const price = quote.expectedSelfListCents;

  return (
    <section className="space-y-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Sell</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {quote.kind === 'game'
              ? 'Asking prices for the same game, less eBay fees, shipping and effort.'
              : 'Asking prices for the same edition, less eBay fees, shipping and effort.'}
          </p>
        </div>
        {quote.priceable && quote.priceSource !== 'none' && (
          <form action={priceAction}>
            <input type="hidden" name="inventory_item_id" value={itemId} />
            <Button type="submit" size="sm" disabled={pricePending}>
              {pricePending ? 'Pricing…' : price == null ? 'Price it' : 'Price it again'}
            </Button>
          </form>
        )}
      </div>

      {!quote.priceable ? (
        <p className="text-[13px] text-ink-faint">
          {quote.needsConfirmation ? (
            <>
              Confirm which {quote.kind === 'game' ? 'game' : 'edition'} this is on the{' '}
              <Link href="/shopping/sell" className="text-brand hover:underline">
                sell page
              </Link>{' '}
              before it can be priced.
            </>
          ) : quote.kind === 'game' ? (
            'No BoardGameGeek match yet, so there is nothing to look up.'
          ) : (
            'No ISBN yet, so there is nothing to look up.'
          )}
        </p>
      ) : quote.priceSource === 'none' ? (
        <p className="text-[13px] text-ink-faint">
          No price source is configured, so prices can only be set by hand.
        </p>
      ) : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">Expected price</dt>
          <dd className="tabular font-medium text-ink">
            {price != null ? formatMoney(price) : 'Not priced yet'}
            {price != null && (
              <span className="ml-2 text-[12px] font-normal text-ink-muted">
                {quote.priceIsManual
                  ? 'your price'
                  : quote.priceSource === 'web_estimate'
                    ? 'web estimate'
                    : 'eBay asks'}
                {quote.quoteIsStale ? ' · out of date' : ''}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Net if you list it</dt>
          <dd className="tabular font-medium text-ink">
            {quote.netSelfCents != null ? formatMoney(quote.netSelfCents) : '—'}
          </dd>
        </div>
        {quote.buyback && (
          <div>
            <dt className="text-ink-muted">Buyback</dt>
            <dd className="tabular text-ink">
              {formatMoney(quote.netBuybackCents ?? quote.buyback.cents)}
              {quote.buyback.url ? (
                <a
                  href={quote.buyback.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-[12px] text-brand underline"
                >
                  {quote.buyback.vendor}
                </a>
              ) : (
                <span className="ml-2 text-[12px] text-ink-muted">{quote.buyback.vendor}</span>
              )}
            </dd>
          </div>
        )}
        {quote.path && (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">Suggested</dt>
            <dd className="text-ink">
              <span className="font-medium">{PATH_LABEL[quote.path]}</span>{' '}
              <span className="text-ink-muted">{quote.reason}</span>
              {quote.path === 'donate' && quote.donateFmvCents > 0 && (
                <span className="ml-2 text-[12px] text-ink-muted">
                  FMV hint {formatMoney(quote.donateFmvCents)} (not tax advice)
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      <form action={manualAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <input type="hidden" name="inventory_item_id" value={itemId} />
        <Input
          name="price"
          defaultValue={
            quote.priceIsManual && price != null ? formatCentsAsDollarsInput(price) : ''
          }
          placeholder="Own price"
          className="w-28"
          aria-label="Price you found yourself"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={manualPending}>
          {manualPending ? 'Saving…' : 'Set price'}
        </Button>
        <span className="text-[12px] text-ink-faint">Beats any lookup; clear it to go back.</span>
      </form>

      {(priceState.message || manualState.message) && (
        <p className="text-sm text-positive">{priceState.message ?? manualState.message}</p>
      )}
      <FieldError>{priceState.error ?? manualState.error}</FieldError>
    </section>
  );
}
