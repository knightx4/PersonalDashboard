import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadIdeaMap } from '@/lib/learn/map/load';
import { parseMapParams } from '@/lib/learn/map/view';
import { IdeaSpaceView } from './idea-space-view';

export const dynamic = 'force-dynamic';

/**
 * Idea Space (plan #1857), reached from Know: every idea Learn holds on one
 * map, placed by what it says.
 *
 * Nothing is stored. At a few hundred ideas the layouts take well under a
 * second, so the map is worked out on each visit (lib/learn/map/load.ts) and
 * is never out of date. A failed read is said on the page rather than drawn
 * as an empty map, which would read as "no ideas" (law 2).
 */
export default async function IdeaSpacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const [learn, search] = await Promise.all([createLearnClient(), searchParams]);
  const view = await loadIdeaMap(learn).catch((error: unknown) => {
    console.error('[learn idea space]', error instanceof Error ? error.message : error);
    return null;
  });
  return <IdeaSpaceView view={view} params={parseMapParams(search)} />;
}
