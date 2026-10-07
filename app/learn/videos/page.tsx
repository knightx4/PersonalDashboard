import { notFound } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { filterVideos, isPile, loadListVideos, loadVideoCards } from '@/lib/learn/youtube/videos';
import { loadClipProgress } from '@/lib/learn/clips/progress';
import { clipProgressLine } from '@/lib/learn/clips/progress-line';
import { loadPlayerClips } from '@/lib/learn/clips/player-clips';
import { loadChannelSummaries, loadUsage } from '@/lib/learn/youtube/load';
import { loadWatchListSettings } from '@/lib/learn/youtube/watch-list';
import { VideosView } from './videos-view';

export const dynamic = 'force-dynamic';
// Following a channel from the YouTube library section lists every video and
// playlist it has, which for a big channel is a few hundred Data API calls.
export const maxDuration = 300;
export const metadata = { title: 'Videos' };

/** Videos; videos-view.tsx says what the page holds and how it is drawn. */
export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; verdict?: string; open?: string }>;
}) {
  const user = await getUser();
  if (!user || !(await isOwner({ user }))) notFound();
  const { q, verdict: rawVerdict, open } = await searchParams;
  const pile = isPile(rawVerdict) ? rawVerdict : null;
  const playing = open === 'clips';

  const learn = await createLearnClient();
  const now = new Date();
  const [all, cards, clipProgress, channels, usage, list, clips] = await Promise.all([
    loadListVideos(learn, user.id),
    loadVideoCards(learn, user.id),
    loadClipProgress(learn, user.id),
    loadChannelSummaries(learn),
    loadUsage(learn),
    loadWatchListSettings(learn, user.id),
    playing ? loadPlayerClips(learn, user.id, { now: now.getTime() }) : Promise.resolve(null),
  ]);
  const videos = filterVideos(all, { q, verdict: pile });
  const cardCounts = new Map([...cards].map(([videoId, list]) => [videoId, list.length]));

  return (
    <VideosView
      all={all}
      videos={videos}
      q={q}
      pile={pile}
      cardCounts={cardCounts}
      clipCounts={clipProgress.perVideo}
      progress={clipProgressLine(clipProgress, now)}
      clips={clips}
      channels={channels}
      usage={usage}
      list={list}
      now={now.getTime()}
      open={open}
    />
  );
}
