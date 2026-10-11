import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ClipPlayer } from '@/components/learn/clip-player';
import { clockTime, durationLabel } from '@/lib/learn/youtube/format';
import type { VideoPage } from '@/lib/learn/youtube/load';
import type { Paragraph } from '@/lib/learn/youtube/paragraphs';
import { transcribeVideoAction } from '../../actions';
import { Press } from '../../press';

/**
 * One video: the player, and the transcript under it.
 *
 * Each paragraph's time is a link that reloads the page with the player
 * starting there. A link rather than a script talking to the player, so it
 * works before JavaScript does (law 6) and a moment in a lecture is a URL you
 * can keep. The player is the embed Learn will use for a recommended clip,
 * with a start and an end.
 */
export type LibraryVideoViewProps = {
  data: VideoPage;
  /** The captions' language, when a transcript was read. */
  language: string | null;
  paragraphs: Paragraph[];
  start: number;
  stop: number | null;
};

export function LibraryVideoView({ data, language, paragraphs, start, stop }: LibraryVideoViewProps) {
  const { video, channel, segments } = data;
  const timed = segments.filter((segment) => segment.tStartSeconds !== null);
  const embedded = segments.filter((segment) => segment.embedded).length;

  return (
    <>
      {channel && (
        <p className="mb-3">
          <Link
            href={`/learn/youtube/${channel.slug}`}
            className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
            {channel.name}
          </Link>
        </p>
      )}

      <PageHeader
        title={video.title}
        description={
          <>
            {[durationLabel(video.durationSeconds), language ? `captions: ${language}` : null]
              .filter(Boolean)
              .join(' · ')}
            {video.durationSeconds !== null || language ? ' · ' : ''}
            <a href={video.url} className="hover:underline" target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
          </>
        }
      />

      <ClipPlayer videoId={video.videoId} title={video.title} start={start} end={stop} />

      {timed.length > 0 && (
        <p className="mt-3 text-small text-ink-muted">
          Cut into {timed.length} {timed.length === 1 ? 'clip' : 'clips'} for Learn
          {embedded < segments.length ? `, ${embedded} embedded so far` : ', all embedded'}.
        </p>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">Transcript</h2>
        {paragraphs.length > 0 ? (
          <div className="max-w-prose space-y-3">
            {paragraphs.map((paragraph) => (
              <p key={paragraph.startSeconds} className="text-body text-ink">
                <Link
                  href={`/learn/youtube/v/${video.videoId}?t=${Math.floor(paragraph.startSeconds)}`}
                  className="mr-2 text-small tabular-nums text-ink-muted hover:text-accent"
                  scroll={false}
                >
                  {clockTime(paragraph.startSeconds)}
                </Link>
                {paragraph.text}
              </p>
            ))}
          </div>
        ) : video.state === 'fetched' ? (
          <p role="alert" className="text-ui text-danger">
            The transcript is recorded as stored but could not be read from storage.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-ui text-ink-muted">
              {video.state === 'none'
                ? 'TranscriptAPI found no captions for this video.'
                : video.state === 'queued'
                  ? 'Queued for the next scheduled run.'
                  : video.state === 'failed'
                    ? `The last attempt failed${video.note ? `: ${video.note}` : ''}.`
                    : 'Not fetched yet. It costs one credit.'}
            </p>
            {video.state !== 'queued' && (
              <Press
                action={transcribeVideoAction}
                cost="app/learn/youtube/actions.ts#transcribeVideoAction"
                fields={{ videoId: video.videoId }}
                label={video.state === 'none' ? 'Try again' : 'Get transcript'}
                pendingLabel="Fetching…"
              />
            )}
          </div>
        )}
      </section>
    </>
  );
}
