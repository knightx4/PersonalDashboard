import { requireUser } from '@/lib/auth/server';
import { savePlace } from '../actions';
import { PlaceForm } from '../place-form';

export const metadata = { title: 'Add a place' };

/** Adding a place they have lived (plan #1991.5). */
export default async function Page() {
  await requireUser();
  return <PlaceForm place={null} save={savePlace} />;
}
