import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { buttonVariants } from '@/components/ui/button';
import { Card, cardVariants, CardSection } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { EditSavedForm, SavedStatusActions } from './item-forms';

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
 * draw it from fixtures (plan #1604).
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
    // A detail page read top to bottom, so the reading column rather than the
    // single-form width, even though most of it is an edit form.
    <div className="mx-auto max-w-3xl space-y-8 [&_a]:press-area max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11 max-sm:[&_textarea]:min-h-11">
      <PageHeader
        title={item.title ?? 'Untitled'}
        description={[merchant?.name, item.status, item.created_at?.slice(0, 10)]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Open product
            </a>
            <Link
              href="/shopping/saved"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              All saved
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="sm:w-48">
          <Card padding="none" className="aspect-square overflow-hidden bg-canvas">
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
              <img src={item.image_url} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-small text-ink-muted">
                No image
              </span>
            )}
          </Card>
        </div>
        <dl
          className={cn(
            cardVariants({ padding: 'dense' }),
            'grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 text-body sm:grid-cols-2',
          )}
        >
          <div>
            <dt className="text-ink-muted">Price</dt>
            <dd className="tabular font-medium text-ink">
              {item.price_cents != null
                ? formatMoney(item.price_cents, item.currency ?? 'USD')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Status</dt>
            <dd className="capitalize text-ink">{item.status}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">URL</dt>
            <dd className="truncate">
              <a href={item.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                {item.url}
              </a>
            </dd>
          </div>
        </dl>
      </div>

      {ownedMatches.length > 0 && (
        <Banner tone="warn">
          <p className="font-medium">You may already own this</p>
          <ul className="mt-2 space-y-1 text-ui text-ink-muted">
            {ownedMatches.map((match) => (
              <li key={match.id}>
                <Link href={`/shopping/inventory/${match.id}`} className="text-accent hover:underline">
                  {match.name}
                  {match.variant ? ` · ${match.variant}` : ''}
                </Link>
                {match.cost_cents != null && <> · {formatMoney(match.cost_cents)}</>}
                {match.acquired_at && <> · {match.acquired_at}</>}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <CardSection title="Edit">
        <EditSavedForm
          item={{
            id: item.id,
            url: item.url,
            title: item.title,
            imageUrl: item.image_url,
            priceCents: item.price_cents,
            currency: item.currency ?? 'USD',
            notes: item.notes,
            merchantId: item.merchant_id,
          }}
        />
      </CardSection>

      <section className="space-y-3">
        <h2 className="text-ui font-semibold text-ink">Queue actions</h2>
        <SavedStatusActions itemId={item.id} status={item.status} />
      </section>
    </div>
  );
}
