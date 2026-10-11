import { notFound } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadSubject } from '@/lib/learn/graph/load';
import { loadPlayerClips } from '@/lib/learn/clips/player-clips';
import { loadSubjectClipCounts } from '@/lib/learn/clips/subject';
import { SubjectClipsView } from './view';

export const dynamic = 'force-dynamic';

/**
 * One subject's Clips (plan #1697): the clip player holding only the clips
 * tagged to this subject in learn.video_clip_subjects, from Watch later and
 * from followed channels alike, with the ranking, the two-a-video cap and the
 * video gap the full player uses.
 *
 * The owner's alone, like Videos and its Clips section, since the clips are
 * cut from the owner's YouTube library. Anyone else gets a not found.
 */
export default async function SubjectClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user || !(await isOwner({ user }))) notFound();

  const learn = await createLearnClient();
  const subject = await loadSubject(learn, id);
  if (!subject) notFound();

  const [clips, counts] = await Promise.all([
    loadPlayerClips(learn, user.id, { subjectId: id }),
    loadSubjectClipCounts(learn, user.id, id),
  ]);

  return <SubjectClipsView subject={{ id, name: subject.name }} clips={clips} counts={counts} />;
}
