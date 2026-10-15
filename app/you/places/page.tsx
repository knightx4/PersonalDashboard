import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { drawPlacesMap } from '@/lib/you/places-map-outlines';
import { listPlaces } from '@/lib/you/places-store';
import { PlacesView, readPlacesView } from './places-view';

export const metadata = { title: 'Places' };

/**
 * You's Places tab (plan #1991.5): where they have lived, newest first, as a
 * list or, with `?view=map`, on a map (plan #2091.4). The map's outlines are
 * drawn here on the server, only when the map is asked for.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser();
  const view = readPlacesView((await searchParams).view);
  const places = await listPlaces(await createYouClient(), user.id);
  return <PlacesView places={places} view={view} map={view === 'map' ? drawPlacesMap(places) : null} />;
}
