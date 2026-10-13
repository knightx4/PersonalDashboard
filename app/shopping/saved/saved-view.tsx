import { Bookmark } from 'lucide-react';
import Link from '@/components/ui/link';
import { ListPage } from '@/components/patterns/list-detail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { toggleChipClass } from '@/components/ui/chip';
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

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "2 Oct", from the row's timestamp. */
function savedOn(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

const EMPTY: Record<SavedStatus, { title: string; description: string }> = {
  saved: {
    title: 'Nothing saved yet',
    description:
      'Things you want, held in a queue instead of a cart. Paste a product link above to fill in its title, picture and price.',
  },
  purchased: {
    title: 'No purchased saves',
    description: 'When you buy something from this queue, mark it purchased on its own page.',
  },
  dismissed: {
    title: 'Nothing dismissed',
    description: 'Items you decide against land here so they stay out of the queue.',
  },
};

/**
 * One saved link: `ListRow` (components/patterns/list-detail.tsx) with a
 * thumbnail before the name.
 */
function SavedRow({ item, withPicture }: { item: SavedQueueItem; withPicture: boolean }) {
  const meta = [item.merchant?.name, savedOn(item.created_at)].filter(Boolean).join(' · ');
  return (
    <li>
      <Link
        href={`/shopping/saved/${item.id}`}
        className="card-pad-x row-pad flex min-h-11 items-center gap-3 hover:bg-sunken"
      >
        {withPicture && (
          <span className="block size-10 shrink-0 overflow-hidden rounded-control bg-sunken">
            {item.image_url && (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
              <img src={item.image_url} alt="" className="size-full object-cover" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-ink">{item.title ?? 'Untitled'}</span>
          {meta && <span className="block truncate text-small text-ink-muted">{meta}</span>}
        </span>
        {item.price_cents != null && (
          <span className="tabular shrink-0 text-small text-ink-muted">
            {formatMoney(item.price_cents, item.currency ?? 'USD')}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Saved, drawn from what the page read (page.tsx), so the gallery can draw it
 * from fixtures (plan #1604). The list-and-detail pattern: the header with
 * the link box, the status chips, one surface of rows, then the count
 * (plan #1786).
 */
export function SavedQueueView({ status, items }: { status: SavedStatus; items: SavedQueueItem[] }) {
  const header = (
    <>
      <PageHeader title="Saved" />
      {status === 'saved' && (
        <div className="mb-4">
          <SaveForm compact />
        </div>
      )}
    </>
  );

  const tools = (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by status">
      {STATUSES.map((entry) => (
        <Link
          key={entry.id}
          href={savedHref(entry.id)}
          aria-current={entry.id === status ? 'page' : undefined}
          className={toggleChipClass(entry.id === status)}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );

  // A column of pictures when any row has one, so the names line up; a row
  // without one keeps the space empty.
  const anyPicture = items.some((item) => item.image_url);

  return (
    <div className="max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11">
      {items.length === 0 ? (
        <div className="mx-auto max-w-3xl">
          {header}
          <div className="mb-4">{tools}</div>
          <EmptyState
            icon={Bookmark}
            title={EMPTY[status].title}
            description={EMPTY[status].description}
            // The composer that fills the saved queue sits just above, so its
            // action points at the URL box rather than at another page.
            action={
              status === 'saved'
                ? { label: 'Save your first link', href: '#url' }
                : { label: 'Back to saved', href: '/shopping/saved' }
            }
          />
        </div>
      ) : (
        <ListPage header={header} tools={tools} foot={`${items.length} ${status}`}>
          {items.map((item) => (
            <SavedRow key={item.id} item={item} withPicture={anyPicture} />
          ))}
        </ListPage>
      )}
    </div>
  );
}
