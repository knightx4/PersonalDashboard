import { Disclosure } from '@/components/ui/disclosure';
import { formatMoney } from '@/lib/money';
import { formatRange, type PriceEvidence } from '@/lib/sell/price-evidence';

/**
 * The listings behind the number.
 *
 * A single price cannot be argued with, which is the problem: $12 from three
 * listings spanning $4 to $80 is a different fact from $12 from thirty tightly
 * clustered ones, and the router cannot tell you which you have. So the spread
 * sits next to the price, and the listings themselves are one click away.
 *
 * A web estimate has no listings, only the pages it read. They are shown as
 * sources, without prices, because inventing a price column for a citation
 * would misrepresent what the row is.
 */
export function PriceEvidenceDetail({ evidence }: { evidence: PriceEvidence }) {
  const isEbay = evidence.source === 'ebay_browse';
  const range = formatRange(evidence.lowCents, evidence.highCents, formatMoney);
  const priced = evidence.listings.filter((l) => l.priceCents != null);
  const rows = isEbay ? priced : evidence.listings;
  if (rows.length === 0 && !range) return null;

  const count = isEbay ? (evidence.sampleSize ?? priced.length) : rows.length;

  return (
    // The shared fold, not a fifth hand-rolled <details> in a box of its own:
    // this sits inside the Sell card, which already drew the frame, and the
    // closed line has to carry the spread and the median for opening it to be
    // a choice rather than a check. Laws 10 and 11.
    <Disclosure
      title={
        isEbay
          ? `${count} listing${count === 1 ? '' : 's'}`
          : `${count} source${count === 1 ? '' : 's'}`
      }
      meta={
        <>
          {range && <span className="tabular">{range}</span>}
          {isEbay && evidence.medianCents != null && (
            <span className="tabular"> · median {formatMoney(evidence.medianCents)}</span>
          )}
          {/* Which rule set the price, because "median of 3" is a warning and
              "40th percentile of 20" is not. */}
          {evidence.typicalBasis === 'median' && <span> · too few to rank, using the median</span>}
          {isEbay &&
            evidence.totalMatches != null &&
            evidence.totalMatches > (evidence.sampleSize ?? 0) && (
              <span> · {evidence.totalMatches} listed in total</span>
            )}
        </>
      }
    >
      <div>
        {evidence.note && <p className="mb-2 text-small text-ink-muted">{evidence.note}</p>}
        {evidence.query && (
          // The query is shown because a wrong price is usually a wrong search.
          <p className="mb-2 text-small text-ink-muted">
            Searched for <span className="text-ink">{evidence.query}</span>
          </p>
        )}
        <ul className="space-y-1">
          {rows.map((listing, i) => (
            <li
              key={`${listing.url ?? listing.title ?? 'row'}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/50 pb-1 last:border-0"
            >
              <span className="min-w-0 flex-1 text-ui">
                {listing.url ? (
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    {listing.title ?? listing.url}
                  </a>
                ) : (
                  <span className="text-ink">{listing.title ?? 'Untitled'}</span>
                )}
                {listing.condition && (
                  <span className="ml-2 text-small text-ink-muted">{listing.condition}</span>
                )}
              </span>
              {listing.priceCents != null && (
                <span className="tabular text-ui text-ink">
                  {formatMoney(listing.priceCents)}
                  {listing.shippingCents != null && (
                    <span className="ml-1 text-small text-ink-muted">
                      {listing.shippingCents === 0
                        ? '+ free ship'
                        : `+ ${formatMoney(listing.shippingCents)} ship`}
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Disclosure>
  );
}

