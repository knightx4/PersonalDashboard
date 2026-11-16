import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadShelves } from '@/lib/learn/reader/store';
import { IdeasView } from './ideas-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ideas you have met' };

/** The one-idea line of every section read; ideas-view.tsx says how it is drawn. */
export default async function IdeasPage() {
  const user = await requireUser();
  const shelves = await loadShelves(await createLearnClient(), user.id);
  return <IdeasView ideas={shelves.ideas} />;
}
