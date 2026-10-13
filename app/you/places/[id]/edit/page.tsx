import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { getPlace } from '@/lib/you/places-store';
import { savePlace } from '../../actions';
import { PlaceForm } from '../../place-form';

export const metadata = { title: 'Edit place' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Changing a place they lived (plan #1991.5). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const place = await getPlace(await createYouClient(), user.id, id);
  if (!place) notFound();
  return <PlaceForm place={place} save={savePlace} />;
}
