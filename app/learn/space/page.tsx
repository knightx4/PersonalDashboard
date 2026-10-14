import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadIdeaMap } from '@/lib/learn/map/load';
import { parseMapParams } from '@/lib/learn/map/view';
import { loadRecording } from '@/lib/learn/map/recording-store';
import { saveRecordingAction } from './actions';
import { IdeaSpaceView } from './idea-space-view';

export const dynamic = 'force-dynamic';

/**
 * Idea Space (plan #1857), a tab of its own in Learn: every idea Learn holds on one
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
  const user = await requireUser();
  const [learn, search] = await Promise.all([createLearnClient(), searchParams]);
  const recording = await loadRecording(learn, user.id).catch((error: unknown) => {
    console.error('[learn idea space] recording', error instanceof Error ? error.message : error);
    return undefined;
  });
  const view = await loadIdeaMap(learn).catch((error: unknown) => {
    console.error('[learn idea space]', error instanceof Error ? error.message : error);
    return null;
  });
  return (
    <IdeaSpaceView
      view={view}
      params={parseMapParams(search)}
      recording={recording}
      save={saveRecordingAction}
    />
  );
}
