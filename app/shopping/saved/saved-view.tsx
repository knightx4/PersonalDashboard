import { Bookmark } from 'lucide-react';
import Link from 'next/link';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { SaveForm } from './save-form';

export const STATUSES = [
  { id: 'saved', label: 'Saved' },
  { id: 'purchased', label: 'Purchased' },
  { id: 'dismissed', label: 'Dismissed' },
] as const;

export type SavedStatus = (typeof STATUSES)[number]['id'];

function savedHref(status: SavedStatus): string {
  return status === 'saved' ? '/shopping/saved' : `/shopping/saved?status=${status}`;
}

/** One saved link as the queue shows it. */
export type SavedQueueItem = {
  id: string;
  title: string | null;
  image_url: string | null;
  price_cents: number | null;
  currency: string | null;
  created_at: string | null;
  merchant: { name: string } | null;
};

/**
 * Saved, drawn from what the page read (page.tsx), so the gallery can draw it
 * from fixtures (plan #1604).
 */
export function SavedQueueView({ status, items }: { status: SavedStatus; items: SavedQueueItem[] }) {
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
    <div className="flex flex-col gap-6 xl:flex-row max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11">
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

        {items.length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title={emptyCopy[status].title}
            description={emptyCopy[status].description}
            // The composer that fills the saved queue sits just above, so its
            // action points at the URL box rather than at another page.
            action={
              status === 'saved'
                ? { label: 'Save your first link', href: '#url' }
                : { label: 'Back to saved', href: '/shopping/saved' }
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const merchant = item.merchant;
              return (
                <li key={item.id}>
                  <Link
                    href={`/shopping/saved/${item.id}`}
                    className={cn(
                      cardVariants({ padding: 'none', interactive: true }),
                      'block overflow-hidden',
                    )}
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
                        <div className="flex size-full items-center justify-center text-small text-ink-muted">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 px-3 py-3">
                      <p className="line-clamp-2 font-medium text-ink">
                        {item.title ?? 'Untitled'}
                      </p>
                      <p className="truncate text-ui text-ink-muted">
                        {[merchant?.name, item.created_at?.slice(0, 10)].filter(Boolean).join(' · ')}
                      </p>
                      <p className="tabular text-body font-medium text-ink">
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
