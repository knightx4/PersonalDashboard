import { House, Pencil } from 'lucide-react';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import Link from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { SectionHeading } from '@/components/ui/section-heading';
import { formatRoughDate, isCurrent, placeHref, timeThere, type Place } from '@/lib/you/places';
import { positionOf } from '@/lib/you/places-map';
import { PlaceMapSection } from './place-map-section';

/**
 * One place they lived (plan #1991.5), in the list-and-detail pattern: the
 * header with Edit and Remove, the facts as a grid, then the note, then
 * where it is on the map (plan #2091.5).
 *
 * `remove` is the server action, passed in so the gallery can draw the page
 * without one. `thisMonth` is 'YYYY-MM', for how long they have lived in a
 * home they still live in.
 */
export function PlaceView({
  place,
  thisMonth,
  remove,
  subject,
  map,
}: {
  place: Place;
  thisMonth: string;
  /** The path from the catalogue (rowSubject); the gallery passes none and gets it from the place. */
  subject?: Subject;
  remove?: (form: FormData) => Promise<unknown>;
  /** Where it is on the map (plan #2091.5): the section's drawing, actions and, for the gallery, its opening state. */
  map?: Omit<React.ComponentProps<typeof PlaceMapSection>, 'placeId' | 'positioned'>;
}) {
  const header = (
    <PageHeader
      title={place.name}
      subject={
        subject ?? {
          ref: `you.places:${place.id}`,
          path: [
            { label: 'You', href: '/you/personality' },
            { label: 'Places', href: '/you/places' },
            { label: place.name, href: placeHref(place.id) },
          ],
        }
      }
      actions={
        <>
          <Link
            href={`${placeHref(place.id)}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
            Edit
          </Link>
          <ConfirmStep
            prompt="Remove this place for good?"
            confirmLabel="Yes, remove"
            pendingLabel="Removing…"
            action={remove}
            fields={{ id: place.id }}
          >
            Remove
          </ConfirmStep>
        </>
      }
    />
  );

  return (
    <DetailPage
      header={header}
      details={
        <DetailFacts>
          <Property label="City" value={place.city ?? '–'} />
          <Property label="Region" value={place.region ?? '–'} />
          <Property label="Country" value={place.country ?? '–'} />
          <Property label="Time there" value={timeThere(place, thisMonth)} />
          <Property label="Moved in" value={formatRoughDate(place.movedIn)} />
          <Property
            label="Moved out"
            value={
              isCurrent(place) ? (
                <span className="inline-flex items-center gap-1.5">
                  <House className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  Still there
                </span>
              ) : (
                formatRoughDate(place.movedOut ?? '')
              )
            }
          />
        </DetailFacts>
      }
      text={
        place.note ? (
          <section>
            <SectionHeading title="Note" />
            <Card padding="standard">
              <p className="whitespace-pre-line text-body text-ink">
                <LinkedText text={place.note} />
              </p>
            </Card>
          </section>
        ) : undefined
      }
    >
      {map && <PlaceMapSection placeId={place.id} positioned={positionOf(place) !== null} {...map} />}
    </DetailPage>
  );
}
