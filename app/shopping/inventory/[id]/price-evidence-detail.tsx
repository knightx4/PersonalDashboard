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

  return (
    <details className="group rounded-lg border border-border bg-canvas">
      <summary className="cursor-pointer list-none px-3 py-2 text-ui text-ink-muted">
        <span className="text-ink">
          {isEbay
            ? `${evidence.sampleSize ?? priced.length} listing${
                (evidence.sampleSize ?? priced.length) === 1 ? '' : 's'
              }`
            : `${rows.length} source${rows.length === 1 ? '' : 's'}`}
        </span>
        {range && <span className="tabular"> · {range}</span>}
        {isEbay && evidence.medianCents != null && (
          <span className="tabular"> · median {formatMoney(evidence.medianCents)}</span>
        )}
        {isEbay && evidence.totalMatches != null && evidence.totalMatches > (evidence.sampleSize ?? 0) && (
          <span> · {evidence.totalMatches} listed in total</span>
        )}
        <span className="ml-2 text-small text-accent group-open:hidden">show</span>
        <span className="ml-2 hidden text-small text-accent group-open:inline">hide</span>
      </summary>

      <div className="border-t border-border px-3 py-2">
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
    </details>
  );
}

