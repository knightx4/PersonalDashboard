import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { drawPlaceMap } from '@/lib/you/places-map-outlines';
import { listPlaces } from '@/lib/you/places-store';
import { placeOnMap, removePlace, worldMap } from '../actions';
import { toRef } from '@/lib/core/refs';
import { rowSubject } from '@/lib/core/subject';
import { PlaceView } from '../place-view';

export const metadata = { title: 'Place' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One place they lived (plan #1991.5). All their places are read, since a
 * place with no position is set on a map of the region the others are in
 * (plan #2091.5).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const places = await listPlaces(await createYouClient(), user.id);
  const place = places.find((one) => one.id === id);
  if (!place) notFound();
  return (
    <PlaceView
      place={place}
      thisMonth={new Date().toISOString().slice(0, 7)}
      remove={removePlace}
      subject={await rowSubject(toRef('you.places', place.id))}
      map={{ ...drawPlaceMap(place, places), save: placeOnMap, loadWorld: worldMap }}
    />
  );
}
