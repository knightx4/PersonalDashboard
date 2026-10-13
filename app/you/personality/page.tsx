import { requireUser } from '@/lib/auth/server';
import { YouTabEmpty } from '../you-tabs';

export const metadata = { title: 'Personality' };

/** You's Personality tab, empty until its step under plan #1991 fills it. */
export default async function Page() {
  await requireUser();
  return <YouTabEmpty tab="personality" />;
}
