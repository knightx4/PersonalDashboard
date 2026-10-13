import Link, { linkVariants } from '@/components/ui/link';
import { formatMoney } from '@/lib/money';
import { Banner } from '@/components/ui/banner';
import { SavedItemBody } from './item-forms';

export type SavedItemDetail = {
  id: string;
  url: string;
  title: string | null;
  image_url: string | null;
  price_cents: number | null;
  currency: string | null;
  notes: string | null;
  status: 'saved' | 'purchased' | 'dismissed';
  merchant_id: string | null;
  created_at: string | null;
};

export type OwnedMatch = {
  id: string;
  name: string;
  variant: string | null;
  cost_cents: number | null;
  acquired_at: string | null;
};

/**
 * One saved item, drawn from what the page read (page.tsx), so the gallery can
 * draw it from fixtures (plan #1604). Edited where it is read (plan #1787).
 */
export function SavedItemView({
  item,
  merchant,
  ownedMatches,
}: {
  item: SavedItemDetail;
  merchant: { name: string } | null;
  ownedMatches: OwnedMatch[];
}) {
  return (
    <SavedItemBody
      item={{
        id: item.id,
        url: item.url,
        title: item.title,
        imageUrl: item.image_url,
        priceCents: item.price_cents,
        currency: item.currency ?? 'USD',
        notes: item.notes,
        merchantId: item.merchant_id,
        status: item.status,
      }}
      subtitle={[merchant?.name, item.status, item.created_at?.slice(0, 10)]
        .filter(Boolean)
        .join(' · ')}
      banner={
        ownedMatches.length > 0 ? (
          <Banner tone="warn">
            <p className="font-medium">You may already own this</p>
            <ul className="mt-2 space-y-1 text-ui text-ink-muted">
              {ownedMatches.map((match) => (
                <li key={match.id}>
                  <Link
                    href={`/shopping/inventory/${match.id}`}
                    className={linkVariants()}
                  >
                    {match.name}
                    {match.variant ? ` · ${match.variant}` : ''}
                  </Link>
                  {match.cost_cents != null && <> · {formatMoney(match.cost_cents)}</>}
                  {match.acquired_at && <> · {match.acquired_at}</>}
                </li>
              ))}
            </ul>
          </Banner>
        ) : null
      }
    />
  );
}
