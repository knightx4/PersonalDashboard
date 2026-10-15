import { House, MapPin } from 'lucide-react';
import { ListPage } from '@/components/patterns/list-detail';
import { AimButton } from '@/components/shell/aim-button';
import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import Link from '@/components/ui/link';
import { SectionHeading } from '@/components/ui/section-heading';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import type { CaptureAim } from '@/lib/capture/actions';
import { isCurrent, placeHref, placeSpan, placeWhere, type Place } from '@/lib/you/places';
import { splitByPosition, type PlacesMapDrawing } from '@/lib/you/places-map';
import { sectionSubject } from '@/lib/core/section-path';
import { PlacesMap } from './places-map';

/** Add a place opens capture aimed at a place (plan #1950.7): its name, then when. */
const PLACE_AIM: CaptureAim = { kind: 'place' };

export type PlacesViewMode = 'list' | 'map';

/** Which way the tab is read, from its address: `?view=map`, or the list. */
export function readPlacesView(value: string | undefined): PlacesViewMode {
  return value === 'map' ? 'map' : 'list';
}

const LIST_HREF = '/you/places';
const MAP_HREF = '/you/places?view=map';

/**
 * You's Places tab (plan #1991.5): the places they have lived, newest first,
 * with the home they live in now marked. The list-and-detail pattern: the
 * header with its one action, which opens capture aimed at a place, one
 * surface of rows, then the count. Pressing a
 * row opens the place, where it is changed or removed.
 *
 * The Map view (plan #2091.4) is the same places drawn where they are, under
 * the same header and switch, with the ones that have no position yet listed
 * beneath it. The page draws the map's outlines on the server and passes
 * them in as `map`; it is null when no place has a position.
 *
 * The page and the gallery both draw this, so it takes the places and reads
 * nothing itself.
 */
export function PlacesView({
  places,
  view = 'list',
  map = null,
  tipOpenFor,
}: {
  places: readonly Place[];
  view?: PlacesViewMode;
  map?: PlacesMapDrawing | null;
  /** A place whose dot shows its tooltip from the start, for the gallery. */
  tipOpenFor?: string;
}) {
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

  const count = `${places.length} ${places.length === 1 ? 'place' : 'places'}`;

  if (view === 'map') {
    const { onMap, offMap } = splitByPosition(places);
    return (
      <PageColumn>
        {header}
        <div className="mb-4">
          <ViewSwitch view="map" />
        </div>
        {map ? (
          <figure>
            <Card padding="none">
              <PlacesMap drawing={map} tipOpenFor={tipOpenFor} />
            </Card>
            <figcaption className="mt-2 text-small text-ink-muted">
              Your homes joined in the order you moved in.
              {map.dots.some((dot) => dot.current) && ' The house is where you live now.'}
            </figcaption>
          </figure>
        ) : (
          <EmptyState
            icon={MapPin}
            title="Nothing on the map yet"
            description="None of your places has a position yet. A place goes on the map once Dash knows its city; until then the list has them all."
            action={{ label: 'Show the list', href: LIST_HREF }}
          />
        )}
        {map && offMap.length > 0 && (
          <section aria-labelledby="places-off-map" className="mt-6">
            <SectionHeading id="places-off-map" title="Not on the map yet" count={offMap.length} className="mb-2" />
            <Card padding="none">
              <ul className="divide-y divide-border">
                {offMap.map((place) => (
                  <PlaceRow key={place.id} place={place} />
                ))}
              </ul>
            </Card>
          </section>
        )}
        <div className="mt-3 text-small text-ink-muted">
          {map ? `${count}, ${onMap.length} on the map` : count}
        </div>
      </PageColumn>
    );
  }

  return (
    <ListPage header={header} tools={<ViewSwitch view="list" />} foot={count}>
      {places.map((place) => (
        <PlaceRow key={place.id} place={place} />
      ))}
    </ListPage>
  );
}

/** List or Map, as two links, so each view has its own address. */
function ViewSwitch({ view }: { view: PlacesViewMode }) {
  return (
    <span role="group" aria-label="How the places are shown" className={segmentedFrame}>
      <Link href={LIST_HREF} scroll={false} aria-current={view === 'list' ? 'true' : undefined} className={segmentClass(view === 'list')}>
        List
      </Link>
      <Link href={MAP_HREF} scroll={false} aria-current={view === 'map' ? 'true' : undefined} className={segmentClass(view === 'map')}>
        Map
      </Link>
    </span>
  );
}

function PlaceRow({ place }: { place: Place }) {
  const where = placeWhere(place);
  return (
    <li>
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
}
