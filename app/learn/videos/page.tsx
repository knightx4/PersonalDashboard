import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clapperboard, MonitorPlay } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/shell/search-field';
import { EmptyState } from '@/components/ui/empty-state';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import {
  filterVideos,
  isPile,
  loadListVideos,
  loadVideoCards,
  pileCounts,
  PILE_LABEL,
  type Pile,
} from '@/lib/learn/youtube/videos';
import { loadClipProgress } from '@/lib/learn/clips/progress';
import { clipProgressLine } from '@/lib/learn/clips/progress-line';
import { loadPlayerClips } from '@/lib/learn/clips/player-clips';
import { loadChannelSummaries, loadUsage } from '@/lib/learn/youtube/load';
import { loadWatchListSettings } from '@/lib/learn/youtube/watch-list';
import { VideoRows } from './video-rows';
import { CLIPS_HREF, ClipsSection } from './clips-section';
import { LibrarySection, YOUTUBE_HREF } from './library-section';

export const dynamic = 'force-dynamic';
// Following a channel from the YouTube library section lists every video and
// playlist it has, which for a big channel is a few hundred Data API calls.
export const maxDuration = 300;
export const metadata = { title: 'Videos' };

/**
 * Videos: everything video in Learn on one page (plan #1488). First the ones
 * you saved to your Dash playlist (plan #1069), newest added first; then the
 * clips cut from them; then the YouTube library the playlist is set in. The
 * owner's alone, because every transcript the library fetches spends the
 * owner's TranscriptAPI credits.
 *
 * `?verdict=` narrows the list to one pile (#1068): watch, card, skip, or
 * unjudged. `?open=clips` opens the Clips section and starts the player, and
 * `?open=youtube` opens the library: the old /learn/clips and /learn/youtube
 * tabs redirect to those.
 */
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
  const startedAt = new Date().toISOString();
  const [all, cards, clipProgress, channels, usage, list, clips] = await Promise.all([
    loadListVideos(learn, user.id),
    loadVideoCards(learn, user.id),
    loadClipProgress(learn, user.id),
    loadChannelSummaries(learn),
    loadUsage(learn),
    loadWatchListSettings(learn, user.id),
    playing ? loadPlayerClips(learn, user.id, { sessionStartedAt: startedAt }) : Promise.resolve(null),
  ]);
  const videos = filterVideos(all, { q, verdict: pile });
  const cardCounts = new Map([...cards].map(([videoId, list]) => [videoId, list.length]));
  const now = new Date(startedAt);

  const sections = (
    <>
      <ClipsSection
        progress={clipProgressLine(clipProgress, now)}
        player={clips === null ? null : { clips, startedAt }}
      />
      <LibrarySection channels={channels} usage={usage} list={list} now={now.getTime()} open={open === 'youtube'} />
    </>
  );

  if (all.length === 0) {
    return (
      <>
        <PageHeader title="Videos" />
        <EmptyState
          icon={MonitorPlay}
          title="No videos yet"
          description="Save videos to a YouTube playlist of your own and paste its link in the YouTube library below. Every video on it is listed here with a short summary, read again four times a day."
          action={{ label: 'Set your playlist', href: YOUTUBE_HREF }}
        />
        {sections}
      </>
    );
  }

  const watched = all.filter((video) => video.watchedAt !== null).length;
  return (
    <>
      <PageHeader
        title="Videos"
        description={`${all.length} on your list${watched > 0 ? `, ${watched} watched` : ''}`}
        actions={
          <Link href={CLIPS_HREF} className={buttonVariants({ variant: 'secondary' })}>
            <Clapperboard className="size-4" strokeWidth={1.75} aria-hidden />
            Watch as clips
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-full max-w-md">
          <SearchField placeholder="Search titles and channels" />
        </div>
        <Piles current={pile} counts={pileCounts(all)} q={q ?? null} />
      </div>
      {pile && <p className="mb-3 max-w-prose text-ui text-ink-muted">{PILE_NOTE[pile]}</p>}
      {videos.length > 0 ? (
        <VideoRows videos={videos} cardCounts={cardCounts} clipCounts={clipProgress.perVideo} />
      ) : (
        <p className="text-ui text-ink-muted">
          {q ? `Nothing ${pile ? `in ${PILE_LABEL[pile]}` : 'on your list'} matches “${q}”.` : `Nothing in ${PILE_LABEL[pile ?? 'unjudged']} yet.`}
        </p>
      )}
      {sections}
    </>
  );
}

/** What each pile is for, said above it when it is the one shown. */
const PILE_NOTE: Record<Pile, string> = {
  watch: 'Worth watching. Each opens at the stretch the judge picked, and plays on from there.',
  card: 'Enough as a card or two. What each says is on Now as cards, which open the video at the minute they came from.',
  skip: 'Nothing here serves what you are learning. The app only reads your Dash playlist, so take these off it on YouTube when you want them gone.',
  unjudged: 'Not sorted yet. The judge reads new videos on each library run, and one that passed its first look waits for its transcript.',
};

/** The piles as links, so a pile is a URL and works before JavaScript does (law 6). */
function Piles({ current, counts, q }: { current: Pile | null; counts: Record<Pile, number>; q: string | null }) {
  const href = (pile: Pile | null) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (pile) params.set('verdict', pile);
    const query = params.toString();
    return query ? `/learn/videos?${query}` : '/learn/videos';
  };
  const options: { pile: Pile | null; label: string; count: number }[] = [
    { pile: null, label: 'All', count: counts.watch + counts.card + counts.skip + counts.unjudged },
    { pile: 'watch', label: PILE_LABEL.watch, count: counts.watch },
    { pile: 'card', label: PILE_LABEL.card, count: counts.card },
    { pile: 'skip', label: PILE_LABEL.skip, count: counts.skip },
    ...(counts.unjudged > 0 || current === 'unjudged'
      ? [{ pile: 'unjudged' as const, label: PILE_LABEL.unjudged, count: counts.unjudged }]
      : []),
  ];
  return (
    <span role="group" aria-label="Pile" className={segmentedFrame}>
      {options.map((option) => {
        const on = option.pile === current;
        return (
          <Link
            key={option.pile ?? 'all'}
            href={href(option.pile)}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'press inline-flex h-(--control-h) items-center gap-1.5 px-2.5 text-ui font-medium',
              'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
              on ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {option.label}
            <span className="tabular-nums text-small opacity-70">{option.count}</span>
          </Link>
        );
      })}
    </span>
  );
}
