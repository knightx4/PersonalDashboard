import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { listPlaces } from '@/lib/you/places-store';
import { PlacesView } from './places-view';

export const metadata = { title: 'Places' };

/** You's Places tab (plan #1991.5): where they have lived, newest first. */
export default async function Page() {
  const user = await requireUser();
  const places = await listPlaces(await createYouClient(), user.id);
  return <PlacesView places={places} />;
}
