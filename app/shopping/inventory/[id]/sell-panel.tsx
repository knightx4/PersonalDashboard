'use client';

import { useActionState } from 'react';
import {
  priceOneItem,
  searchItemPrice,
  setSellPrice,
  type PriceSearchState,
  type SellActionState,
} from '@/app/shopping/sell/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { formatCentsAsDollarsInput, formatMoney } from '@/lib/money';
import type { ItemSellQuote } from '@/lib/sell/item-quote';
import { formatRange } from '@/lib/sell/price-evidence';
import { PriceEvidenceDetail } from './price-evidence-detail';
import type { SellPath } from '@/lib/sell/route';

const PATH_LABEL: Record<SellPath, string> = {
  list_individually: 'List individually',
  lot: 'Lot together',
  buyback: 'Buyback vendor',
  donate: 'Donate',
};

const initial: SellActionState = {};
const initialSearch: PriceSearchState = {};

/** The button says which source it is about to hit, because they differ a lot. */
const SEARCH_LABEL: Record<string, string> = {
  ebay_browse: 'Search eBay',
  web_estimate: 'Search the web',
};


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
  const [searchState, searchAction, searchPending] = useActionState(
    searchItemPrice,
    initialSearch,
  );
  const [manualState, manualAction, manualPending] = useActionState(setSellPrice, initial);

  const price = quote.expectedSelfListCents;
  const searchLabel = SEARCH_LABEL[quote.priceSource] ?? 'Search for a price';

  return (
    <section className="space-y-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-ink">Sell</h2>
          <p className="mt-1 text-ui text-ink-muted">
            {quote.kind === 'game'
              ? 'Asking prices for the same game, less eBay fees, shipping and effort.'
              : 'Asking prices for the same edition, less eBay fees, shipping and effort.'}
          </p>
        </div>
        {quote.priceSource !== 'none' && (
          <div className="flex flex-wrap gap-2">
            {/* Always offered: a title search needs no confirmed edition, so
                this is the one button that works on an unpriceable item. */}
            <form action={searchAction}>
              <input type="hidden" name="inventory_item_id" value={itemId} />
              <Button type="submit" size="sm" variant="secondary" disabled={searchPending}>
                {searchPending ? 'Searching…' : searchLabel}
              </Button>
            </form>
            {quote.priceable && (
              <form action={priceAction}>
                <input type="hidden" name="inventory_item_id" value={itemId} />
                <Button type="submit" size="sm" disabled={pricePending}>
                  {pricePending ? 'Pricing…' : price == null ? 'Price it' : 'Price it again'}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>

      {searchState.query && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas px-3 py-2 text-ui">
          <span className={searchState.foundCents == null ? 'text-ink-muted' : 'text-ink'}>
            {searchState.foundCents == null
              ? `Nothing comparable is listed for “${searchState.query}”.`
              : `Asking about ${formatMoney(searchState.foundCents)} for “${searchState.query}”.`}
          </span>
          {searchState.foundCents != null && (
            <form action={manualAction}>
              <input type="hidden" name="inventory_item_id" value={itemId} />
              <input
                type="hidden"
                name="price"
                value={formatCentsAsDollarsInput(searchState.foundCents)}
              />
              <Button type="submit" size="sm" variant="secondary" disabled={manualPending}>
                Use this price
              </Button>
            </form>
          )}
        </div>
      )}
      <FieldError>{searchState.error}</FieldError>

      {!quote.priceable ? (
        <p className="text-ui text-ink-muted">
          {quote.needsConfirmation ? (
            <>
              Confirm which {quote.kind === 'game' ? 'box' : 'edition'} this is in{' '}
              {quote.kind === 'game' ? 'Game details' : 'Book details'} above to price and
              cache it — or search on the title now.
            </>
          ) : quote.kind === 'game' ? (
            'No BoardGameGeek match yet, so a search goes on the title alone.'
          ) : (
            'No ISBN yet, so a search goes on the title alone.'
          )}
        </p>
      ) : quote.priceSource === 'none' ? (
        <p className="text-ui text-ink-muted">
          No price source is configured, so prices can only be set by hand.
        </p>
      ) : null}

      <dl className="grid gap-3 text-body sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">Expected price</dt>
          <dd className="tabular font-medium text-ink">
            {price != null ? formatMoney(price) : 'Not priced yet'}
            {price != null && (
              <span className="ml-2 text-small font-normal text-ink-muted">
                {quote.priceIsManual
                  ? 'your price'
                  : quote.priceSource === 'web_estimate'
                    ? 'web estimate'
                    : 'eBay asks'}
                {quote.quoteIsStale ? ' · out of date' : ''}
              </span>
            )}
            {quote.evidence && (
              <span className="ml-2 tabular text-small font-normal text-ink-muted">
                {formatRange(quote.evidence.lowCents, quote.evidence.highCents, formatMoney)}
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
                  className="ml-2 text-small text-accent underline"
                >
                  {quote.buyback.vendor}
                </a>
              ) : (
                <span className="ml-2 text-small text-ink-muted">{quote.buyback.vendor}</span>
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
                <span className="ml-2 text-small text-ink-muted">
                  FMV hint {formatMoney(quote.donateFmvCents)} (not tax advice)
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {quote.evidence && <PriceEvidenceDetail evidence={quote.evidence} />}

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
        <span className="text-small text-ink-muted">Beats any lookup; clear it to go back.</span>
      </form>

      {(priceState.message || manualState.message) && (
        <p className="text-body text-positive">{priceState.message ?? manualState.message}</p>
      )}
      <FieldError>{priceState.error ?? manualState.error}</FieldError>
    </section>
  );
}
