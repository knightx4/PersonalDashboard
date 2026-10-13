import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { getPlace } from '@/lib/you/places-store';
import { removePlace } from '../actions';
import { PlaceView } from '../place-view';

export const metadata = { title: 'Place' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One place they lived (plan #1991.5). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const place = await getPlace(await createYouClient(), user.id, id);
  if (!place) notFound();
  return <PlaceView place={place} thisMonth={new Date().toISOString().slice(0, 7)} remove={removePlace} />;
}
