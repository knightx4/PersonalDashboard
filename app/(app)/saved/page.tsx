import { Bookmark } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/money';
import { SaveForm } from './save-form';

export const metadata = { title: 'Saved' };

const STATUSES = [
  { id: 'saved', label: 'Saved' },
  { id: 'purchased', label: 'Purchased' },
  { id: 'dismissed', label: 'Dismissed' },
] as const;

type SavedStatus = (typeof STATUSES)[number]['id'];

function savedHref(status: SavedStatus): string {
  return status === 'saved' ? '/saved' : `/saved?status=${status}`;
}

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const status: SavedStatus = STATUSES.some((entry) => entry.id === params.status)
    ? (params.status as SavedStatus)
    : 'saved';

  const { data: items, error } = await supabase
    .from('saved_items')
    .select(
      `
      id, title, url, image_url, price_cents, currency, status, created_at, notes,
      merchants ( name )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const emptyCopy: Record<SavedStatus, { title: string; description: string }> = {
    saved: {
      title: 'Nothing saved yet',
      description:
        'Paste a product URL above and we will pull in the title, image and price.',
    },
    purchased: {
      title: 'No purchased saves',
      description: 'When you buy something from this queue, mark it purchased on its detail page.',
    },
    dismissed: {
      title: 'Nothing dismissed',
      description: 'Items you decide against land here so they stay out of the active queue.',
    },
  };

  const showComposer = status === 'saved';

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Status">
          {STATUSES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === status}
              href={savedHref(entry.id)}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Saved"
          description="Things you want, held in a queue instead of a cart."
        />

        {showComposer && (
          <div className="mb-6">
            <SaveForm compact />
          </div>
        )}

        {(items ?? []).length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title={emptyCopy[status].title}
            description={emptyCopy[status].description}
            action={
              status === 'saved'
                ? undefined
                : { label: 'Back to saved', href: '/saved' }
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items!.map((item) => {
              const merchant = Array.isArray(item.merchants)
                ? item.merchants[0]
                : item.merchants;
              return (
                <li key={item.id}>
                  <Link
                    href={`/saved/${item.id}`}
                    className="lift block overflow-hidden rounded-card border border-border bg-surface"
                  >
                    <div className="aspect-[4/3] bg-canvas">
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
                        <img
                          src={item.image_url}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-[12px] text-ink-faint">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 px-3 py-3">
                      <p className="line-clamp-2 font-medium text-ink">
                        {item.title ?? 'Untitled'}
                      </p>
                      <p className="truncate text-[13px] text-ink-muted">
                        {[merchant?.name, item.created_at?.slice(0, 10)].filter(Boolean).join(' · ')}
                      </p>
                      <p className="tabular text-sm font-medium text-ink">
                        {item.price_cents != null
                          ? formatMoney(item.price_cents, item.currency ?? 'USD')
                          : 'Price unknown'}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
