import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { fingerprintLoose } from '@/lib/fingerprint';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EditSavedForm, SavedStatusActions } from './item-forms';

export const metadata = { title: 'Saved item' };

export default async function SavedItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { id } = await params;

  const { data: item } = await supabase
    .from('saved_items')
    .select(
      `
      id, url, title, image_url, price_cents, currency, notes, status,
      merchant_id, fingerprint_loose, created_at,
      merchants ( id, name )
    `,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!item) notFound();

  const merchant = Array.isArray(item.merchants) ? item.merchants[0] : item.merchants;

  let ownedMatches: {
    id: string;
    name: string;
    variant: string | null;
    cost_cents: number | null;
    acquired_at: string | null;
  }[] = [];

  if (item.title) {
    const fp = item.fingerprint_loose ?? fingerprintLoose(item.title);
    const { data } = await supabase
      .from('inventory_items')
      .select('id, name, variant, cost_cents, acquired_at')
      .eq('user_id', user.id)
      .eq('status', 'owned')
      .eq('fingerprint_loose', fp)
      .limit(5);
    ownedMatches = data ?? [];
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
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
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
            <img
              src={item.image_url}
              alt=""
              className="aspect-square w-full rounded-card border border-border object-cover bg-canvas"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-card border border-dashed border-border bg-canvas text-small text-ink-muted">
              No image
            </div>
          )}
        </div>
        <dl className="grid flex-1 gap-3 rounded-card border border-border bg-surface px-4 py-3 text-body sm:grid-cols-2">
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
        <div
          className="rounded-card border border-caution/40 bg-caution-tint px-4 py-3"
          role="status"
        >
          <p className="text-body font-medium text-ink">You may already own this</p>
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
        </div>
      )}

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-4 text-body font-semibold text-ink">Edit</h2>
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
      </section>

      <section className="space-y-3">
        <h2 className="text-body font-semibold text-ink">Queue actions</h2>
        <SavedStatusActions itemId={item.id} status={item.status} />
      </section>
    </div>
  );
}
