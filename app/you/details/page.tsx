import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { getDetails } from '@/lib/you/details-store';
import { saveDetailsForm } from './actions';
import { DetailsView } from './details-view';

export const metadata = { title: 'Details' };

/** You's Details tab (plan #2124.2): phone, LinkedIn, citizenship, race, gender and sexuality. */
export default async function Page() {
  const user = await requireUser();
  const details = await getDetails(await createYouClient(), user.id);
  return <DetailsView details={details} save={saveDetailsForm} />;
}
