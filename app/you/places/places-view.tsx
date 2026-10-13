import { House, MapPin, Plus } from 'lucide-react';
import { ListPage } from '@/components/patterns/list-detail';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import Link from '@/components/ui/link';
import { isCurrent, placeHref, placeSpan, placeWhere, type Place } from '@/lib/you/places';

/**
 * You's Places tab (plan #1991.5): the places they have lived, newest first,
 * with the home they live in now marked. The list-and-detail pattern: the
 * header with its one action, one surface of rows, then the count. Pressing a
 * row opens the place, where it is changed or removed.
 *
 * The page and the gallery both draw this, so it takes the places and reads
 * nothing itself.
 */
export function PlacesView({ places }: { places: readonly Place[] }) {
  const header = (
    <PageHeader
      title="Places"
      actions={
        places.length > 0 ? (
          <Link href="/you/places/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            Add a place
          </Link>
        ) : undefined
      }
    />
  );

  if (places.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <EmptyState
          icon={MapPin}
          title="No places yet"
          description="Add the places you have lived, with a year or a month for when you moved in and out. Dash reads them when you ask where you were living at some point."
          action={{ label: 'Add a place', href: '/you/places/new' }}
        />
      </div>
    );
  }

  return (
    <ListPage header={header} foot={`${places.length} ${places.length === 1 ? 'place' : 'places'}`}>
      {places.map((place) => {
        const where = placeWhere(place);
        return (
          <li key={place.id}>
            <Link
              href={placeHref(place.id)}
              className="card-pad-x row-pad flex min-h-11 items-center gap-3 hover:bg-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  {isCurrent(place) && (
                    // The home they live in now, marked in ink by a shape rather
                    // than a coloured chip (law 4), so the name keeps the row.
                    <House className="size-4 shrink-0 text-ink" strokeWidth={1.75} aria-label="Where you live now" role="img" />
                  )}
                  <span className="truncate text-ui font-medium text-ink">{place.name}</span>
                </span>
                {where && <span className="block truncate text-small text-ink-muted">{where}</span>}
              </span>
              <span className="tabular shrink-0 text-right text-small text-ink-muted">{placeSpan(place)}</span>
            </Link>
          </li>
        );
      })}
    </ListPage>
  );
}
