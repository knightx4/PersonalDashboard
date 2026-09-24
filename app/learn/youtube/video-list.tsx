import Link from 'next/link';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { durationLabel } from '@/lib/learn/youtube/format';
import type { VideoRow } from '@/lib/learn/youtube/load';
import type { TranscriptState } from '@/lib/learn/youtube/transcripts';
import { transcribeVideoAction } from './actions';
import { Press } from './press';

/**
 * A list of videos with each one's transcript state, as one surface.
 *
 * The state is a status glyph with its word beside it, per law 4: a filled
 * hexagon for a stored transcript, an outline for queued, a slash for a video
 * with no captions, a cross for one that failed. A video nobody has asked
 * about gets no glyph, only the button.
 */

const STATE_GLYPH: Record<TranscriptState, { glyph: 'full' | 'empty' | 'slash' | 'cross'; word: string }> = {
  fetched: { glyph: 'full', word: 'Transcript stored' },
  queued: { glyph: 'empty', word: 'Queued' },
  none: { glyph: 'slash', word: 'No captions' },
  failed: { glyph: 'cross', word: 'Failed, will retry' },
};

function published(date: string | null): string | null {
  if (!date) return null;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function VideoList({ videos, numbered = false }: { videos: VideoRow[]; numbered?: boolean }) {
  return (
    <ol className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {videos.map((video, index) => {
        const state = video.state ? STATE_GLYPH[video.state] : null;
        const meta = [published(video.publishedAt), durationLabel(video.durationSeconds)].filter(Boolean);
        return (
          <li key={video.itemId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
            <span className="min-w-0 flex-1">
              <Link
                href={`/learn/youtube/v/${video.videoId}`}
                className="block truncate text-ui text-ink hover:underline"
              >
                {numbered ? <span className="tabular-nums text-ink-muted">{index + 1}. </span> : null}
                {video.title}
              </Link>
              <span className="flex items-center gap-1.5 text-small text-ink-muted">
                {state && <StatusGlyph glyph={state.glyph} size={12} />}
                {[state?.word, ...meta].filter(Boolean).join(' · ')}
                {video.note && video.state === 'failed' ? ` · ${video.note}` : ''}
              </span>
            </span>
            {video.state !== 'fetched' && video.state !== 'queued' && (
              <Press
                action={transcribeVideoAction}
                fields={{ videoId: video.videoId }}
                label={video.state === 'none' ? 'Try again' : 'Get transcript'}
                pendingLabel="Fetching…"
                variant="ghost"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
