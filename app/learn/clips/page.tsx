import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPlayerClips } from '@/lib/learn/clips/player-clips';
import { ClipStream } from './clip-stream';
import { ClipsEmpty } from './empty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clips' };

/**
 * Clips (plan #1400): short clips cut from your videos, played one after
 * another. The owner's alone, like Videos, because the clips are cut from the
 * owner's YouTube library.
 *
 * The time the page opened is the session the picker counts two clips a
 * video against, carried by the player into every fetch for more.
 */
export default async function ClipsPage() {
  const user = await getUser();
  if (!user || !(await isOwner({ user }))) notFound();

  const startedAt = new Date().toISOString();
  const learn = await createLearnClient();
  const clips = await loadPlayerClips(learn, user.id, { sessionStartedAt: startedAt });

  if (clips.length === 0) return <ClipsEmpty />;

  return (
    <>
      <div className="hidden lg:block">
        <PageHeader title="Clips" description="Short clips from your videos, one after another. Swipe up, press the down arrow or let one finish for the next." />
      </div>
      <ClipStream initial={clips} startedAt={startedAt} />
    </>
  );
}
