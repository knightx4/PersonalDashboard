import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadShelves } from '@/lib/learn/reader/store';
import { ReadView } from './read-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Read' };

/** Learn's front page: what there is to read; read-view.tsx says how it is drawn. */
export default async function ReadPage() {
  const user = await requireUser();
  const shelves = await loadShelves(await createLearnClient(), user.id);
  return <ReadView shelves={shelves} />;
}
