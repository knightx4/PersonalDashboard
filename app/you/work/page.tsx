import { requireUser } from '@/lib/auth/server';
import { YouTabEmpty } from '../you-tabs';

export const metadata = { title: 'Work & school' };

/** You's Work & school tab, empty until its step under plan #1991 fills it. */
export default async function Page() {
  await requireUser();
  return <YouTabEmpty tab="work" />;
}
