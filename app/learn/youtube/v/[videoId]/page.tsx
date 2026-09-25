import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { readTranscript } from '@/inngest/learn/youtube-library';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { ClipPlayer } from '@/components/learn/clip-player';
import { clockTime, durationLabel } from '@/lib/learn/youtube/format';
import { loadVideoPage } from '@/lib/learn/youtube/load';
import { paragraphsFromCues } from '@/lib/learn/youtube/paragraphs';
import { transcribeVideoAction } from '../../actions';
import { Press } from '../../press';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const metadata = { title: 'YouTube video' };

/**
 * One video: the player, and the transcript under it.
 *
 * Each paragraph's time is a link that reloads the page with the player
 * starting there. A link rather than a script talking to the player, so it
 * works before JavaScript does (law 6) and a moment in a lecture is a URL you
 * can keep. The player is the embed Learn will use for a recommended clip,
 * with a start and an end.
 */
export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string; end?: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { videoId } = await params;
  const { t, end } = await searchParams;
  const start = Math.max(0, Number.parseInt(t ?? '0', 10) || 0);
  const stop = end ? Number.parseInt(end, 10) || null : null;

  const learn = await createLearnClient();
  const data = await loadVideoPage(learn, videoId);
  if (!data) notFound();
  const { video, channel, segments } = data;

  const transcript = video.state === 'fetched' ? await readTranscript(video.videoId) : null;
  const paragraphs = transcript ? paragraphsFromCues(transcript.cues) : [];
  const timed = segments.filter((segment) => segment.tStartSeconds !== null);
  const embedded = segments.filter((segment) => segment.embedded).length;

  return (
    <>
      {channel && (
        <p className="mb-3">
          <Link
            href={`/learn/youtube/${channel.slug}`}
            className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
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
            {[durationLabel(video.durationSeconds), transcript?.language ? `captions: ${transcript.language}` : null]
              .filter(Boolean)
              .join(' · ')}
            {video.durationSeconds !== null || transcript?.language ? ' · ' : ''}
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
