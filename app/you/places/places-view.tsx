import { House, MapPin } from 'lucide-react';
import { ListPage } from '@/components/patterns/list-detail';
import { AimButton } from '@/components/shell/aim-button';
import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import Link from '@/components/ui/link';
import type { CaptureAim } from '@/lib/capture/actions';
import { isCurrent, placeHref, placeSpan, placeWhere, type Place } from '@/lib/you/places';
import { sectionSubject } from '@/lib/core/section-path';

/** Add a place opens capture aimed at a place (plan #1950.7): its name, then when. */
const PLACE_AIM: CaptureAim = { kind: 'place' };

/**
 * You's Places tab (plan #1991.5): the places they have lived, newest first,
 * with the home they live in now marked. The list-and-detail pattern: the
 * header with its one action, which opens capture aimed at a place, one
 * surface of rows, then the count. Pressing a
 * row opens the place, where it is changed or removed.
 *
 * The page and the gallery both draw this, so it takes the places and reads
 * nothing itself.
 */
export function PlacesView({ places }: { places: readonly Place[] }) {
  const header = (
    <PageHeader
      subject={sectionSubject('/you/places', 'Places')}
      title="Places"
      actions={
        places.length > 0 ? (
          <AimButton aim={PLACE_AIM} label="Add a place" />
        ) : undefined
      }
    />
  );

  if (places.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          icon={MapPin}
          title="No places yet"
          description="Add the places you have lived, with a year or a month for when you moved in and out. Dash reads them when you ask where you were living at some point."
          action={{ label: 'Add a place', aim: PLACE_AIM }}
        />
      </PageColumn>
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
