import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadIdeaPairs } from '@/lib/learn/map/idea-pairs-load';
import { IdeaPairsView } from './pairs-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Same idea twice' };

/**
 * The same idea written in two subjects, still to settle (plan #2147.2). A
 * failed read is said on the page rather than drawn as an empty list.
 */
export default async function IdeaPairsPage() {
  await requireUser();
  const pairs = await loadIdeaPairs(await createLearnClient()).catch((error: unknown) => {
    console.error('[learn idea pairs]', error instanceof Error ? error.message : error);
    return null;
  });
  return <IdeaPairsView pairs={pairs} />;
}
