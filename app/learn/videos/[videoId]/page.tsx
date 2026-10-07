import { notFound } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadListVideo, loadRelatedIdeas, loadVideoCards, type RelatedIdea } from '@/lib/learn/youtube/videos';
import { ListVideoView } from './video-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Video' };

/** One video on your list; video-view.tsx draws it. */
export default async function ListVideoRoute({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const user = await getUser();
  if (!user || !(await isOwner({ user }))) notFound();
  const { videoId } = await params;
  const { t } = await searchParams;

  const learn = await createLearnClient();
  const video = await loadListVideo(learn, user.id, videoId);
  if (!video) notFound();
  const best = video.verdict === 'watch' ? video.bestStartSeconds : null;
  const start = t === undefined && best !== null ? best : Math.max(0, Number.parseInt(t ?? '0', 10) || 0);
  const cards = (await loadVideoCards(learn, user.id, [video.videoId])).get(video.videoId) ?? [];

  // A failure to find related ideas is said in place rather than taking the page down (law 2).
  let related: RelatedIdea[] | null = null;
  let relatedError: string | null = null;
  try {
    related = await loadRelatedIdeas(learn, user.id, video.itemId);
  } catch (error) {
    relatedError = error instanceof Error ? error.message : 'Finding related ideas failed.';
  }

  return (
    <ListVideoView video={video} start={start} cards={cards} related={related} relatedError={relatedError} />
  );
}
