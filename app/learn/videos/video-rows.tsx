import Link from 'next/link';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { durationLabel, thumbnailUrl } from '@/lib/learn/youtube/format';
import type { ListVideo } from '@/lib/learn/youtube/videos';
import { WatchedToggle } from './watched-toggle';

/**
 * Videos on your list as one surface with hairlines between rows (law 13).
 *
 * Takes the rows already narrowed (`filterVideos`), so a search and, for
 * #1068, a verdict filter both arrive here as a shorter list.
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

export function VideoRows({ videos }: { videos: readonly ListVideo[] }) {
  return (
    <ol className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {videos.map((video) => {
        const meta = [video.channel, durationLabel(video.durationSeconds), `added ${addedLabel(video.addedAt)}`].filter(
          Boolean,
        );
        return (
          <li key={video.videoId} className="flex items-center gap-3 px-3 py-2">
            <Link href={`/learn/videos/${video.videoId}`} className="shrink-0" tabIndex={-1} aria-hidden>
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
              <Link
                href={`/learn/videos/${video.videoId}`}
                className="line-clamp-2 text-ui text-ink hover:underline"
              >
                {video.title}
              </Link>
              <span className="block truncate text-small tabular-nums text-ink-muted">{meta.join(' · ')}</span>
            </span>
            <WatchedToggle videoId={video.videoId} watched={video.watchedAt !== null} />
          </li>
        );
      })}
    </ol>
  );
}
