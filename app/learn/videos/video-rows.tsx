import Link from 'next/link';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { clockTime, durationLabel, thumbnailUrl } from '@/lib/learn/youtube/format';
import {
  PILE_LABEL,
  VERDICTS,
  verdictReason,
  videoHref,
  type ListVideo,
} from '@/lib/learn/youtube/videos';
import { moveVideoAction } from './actions';
import { WatchedToggle } from './watched-toggle';

/**
 * Videos on your list as one surface with hairlines between rows (law 13).
 *
 * Takes the rows already narrowed (`filterVideos`), so a search and a pile
 * both arrive here as a shorter list. Each row says which pile the video is
 * in and why (#1068): a Watch video opens at its best minute, a Card video
 * says how many cards it became, and the menu moves it to another pile.
 */

export function addedLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** What the pile means for this video, in a few words beside the pile's name. */
function pileDetail(video: ListVideo, cards: number): string | null {
  if (video.verdict === 'watch') {
    if (video.bestStartSeconds === null) return 'from the start';
    const end = video.bestEndSeconds !== null ? ` to ${clockTime(video.bestEndSeconds)}` : '';
    return `${clockTime(video.bestStartSeconds)}${end}`;
  }
  if (video.verdict === 'card') {
    if (cards > 0) return cards === 1 ? '1 card' : `${cards} cards`;
    return video.stretchCount > 0 ? 'cards within the hour' : 'no cards: nothing marked to make one from';
  }
  return null;
}

export function moveItems(video: Pick<ListVideo, 'videoId' | 'verdict'>): ActionMenuItem[] {
  return VERDICTS.filter((verdict) => verdict !== video.verdict).map((verdict) => ({
    id: verdict,
    label: `Move to ${PILE_LABEL[verdict]}`,
    formAction: moveVideoAction,
    formFields: { videoId: video.videoId, verdict },
  }));
}

export function VideoRows({
  videos,
  cardCounts,
}: {
  videos: readonly ListVideo[];
  /** Cards each video became in Learn now, by video id. */
  cardCounts: ReadonlyMap<string, number>;
}) {
  return (
    <ol className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {videos.map((video) => {
        const href = videoHref(video);
        const meta = [
          video.channel,
          durationLabel(video.durationSeconds),
          video.foundFor ? `found for ${video.foundFor}` : null,
          `added ${addedLabel(video.addedAt)}`,
        ].filter(Boolean);
        const cards = cardCounts.get(video.videoId) ?? 0;
        const detail = pileDetail(video, cards);
        const pile = PILE_LABEL[video.verdict ?? 'unjudged'];
        return (
          <li key={video.videoId} className="flex items-start gap-3 px-3 py-2">
            <Link href={href} className="shrink-0" tabIndex={-1} aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own stills, not worth the image optimiser */}
              <img
                src={thumbnailUrl(video.videoId)}
                alt=""
                loading="lazy"
                width={96}
                height={54}
                className="h-[54px] w-24 rounded-sm bg-sunken object-cover"
              />
            </Link>
            <span className="min-w-0 flex-1">
              <Link href={href} className="line-clamp-2 text-ui text-ink hover:underline">
                {video.title}
              </Link>
              <span className="block truncate text-small tabular-nums text-ink-muted">{meta.join(' · ')}</span>
              <span className="mt-0.5 block text-small text-ink-muted">
                <span className={cn('font-medium', video.verdict ? 'text-ink' : 'text-ink-muted')}>
                  {pile}
                  {detail && video.verdict === 'card' && cards > 0 ? (
                    <>
                      {' · '}
                      <Link href={`/learn/videos/${video.videoId}#cards`} className="tabular-nums hover:underline">
                        {detail}
                      </Link>
                    </>
                  ) : detail ? (
                    <span className="tabular-nums"> · {detail}</span>
                  ) : null}
                </span>
                <span className="line-clamp-2">{verdictReason(video)}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <WatchedToggle videoId={video.videoId} watched={video.watchedAt !== null} />
              <ActionMenu label={`Move ${video.title}`} items={moveItems(video)} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
