import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ClipPlayer } from '@/components/learn/clip-player';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { clockTime, durationLabel } from '@/lib/learn/youtube/format';
import { loadListVideo, loadRelatedIdeas, type ListVideoPage, type RelatedIdea } from '@/lib/learn/youtube/videos';
import { addedLabel } from '../video-rows';
import { WatchedToggle } from '../watched-toggle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Video' };

/**
 * One video on your list (plan #1069): the player, and beside it the summary,
 * the key points and the ideas of yours it is closest to.
 *
 * `?t=` is where the player starts. A chapter is a link that sets it, the same
 * as a transcript line on the library's video page, so a chapter works before
 * JavaScript does (law 6) and a moment is a URL. #1068 plays a Watch video
 * from its best minute by linking here with `?t=` set to it.
 */
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
  const start = Math.max(0, Number.parseInt(t ?? '0', 10) || 0);

  const learn = await createLearnClient();
  const video = await loadListVideo(learn, user.id, videoId);
  if (!video) notFound();

  // A failure to find related ideas is said in place rather than taking the page down (law 2).
  let related: RelatedIdea[] | null = null;
  let relatedError: string | null = null;
  try {
    related = await loadRelatedIdeas(learn, user.id, video.itemId);
  } catch (error) {
    relatedError = error instanceof Error ? error.message : 'Finding related ideas failed.';
  }

  const meta = [
    video.channel,
    durationLabel(video.durationSeconds),
    `added ${addedLabel(video.addedAt)}`,
    video.leftPlaylistAt ? 'no longer on the playlist' : null,
  ].filter(Boolean);

  return (
    <>
      <p className="mb-3">
        <Link href="/learn/videos" className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink">
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Videos
        </Link>
      </p>

      <PageHeader
        title={video.title}
        description={
          <>
            {meta.join(' · ')} ·{' '}
            <a href={video.url} className="hover:underline" target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
          </>
        }
        actions={<WatchedToggle videoId={video.videoId} watched={video.watchedAt !== null} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <ClipPlayer videoId={video.videoId} title={video.title} start={start} />
          {video.chapters.length > 0 && (
            <section>
              <h2 className="mb-1 text-ui font-semibold text-ink-muted">Chapters</h2>
              <ol className="space-y-0.5">
                {video.chapters.map((chapter) => (
                  <li key={chapter.startSeconds} className="flex gap-3 text-ui">
                    <Link
                      href={`/learn/videos/${video.videoId}?t=${chapter.startSeconds}`}
                      scroll={false}
                      className="w-14 shrink-0 text-right tabular-nums text-ink-muted hover:text-accent"
                    >
                      {clockTime(chapter.startSeconds)}
                    </Link>
                    <span className="min-w-0 text-ink">{chapter.title}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <Summary video={video} />
          {relatedError ? (
            <p role="alert" className="text-small text-danger">
              {relatedError}
            </p>
          ) : related && related.length > 0 ? (
            <section>
              <h2 className="mb-1 text-ui font-semibold text-ink-muted">Closest to your ideas</h2>
              <ul className="space-y-1">
                {related.map((idea) => (
                  <li key={idea.conceptId} className="text-ui">
                    <Link href={`/learn/c/${idea.conceptId}`} className="text-ink hover:underline">
                      {idea.name}
                    </Link>
                    {idea.subjectName && idea.subjectId && (
                      <>
                        <span className="text-ink-muted"> in </span>
                        <Link href={`/learn/s/${idea.subjectId}`} className="text-ink-muted hover:underline">
                          {idea.subjectName}
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Where the summary came from, said whenever it was not the transcript (law 2). */
function summaryNote(video: ListVideoPage): string | null {
  if (video.summaryFrom !== 'description') return null;
  return video.transcriptState === 'fetched'
    ? 'Written from the description. The transcript is in, and the next scheduled run rewrites this from it.'
    : 'Written from the description, because the transcript has not been fetched.';
}

function Summary({ video }: { video: ListVideoPage }) {
  if (!video.summary) {
    return (
      <section>
        <h2 className="mb-1 text-ui font-semibold text-ink-muted">Summary</h2>
        <p className="text-ui text-ink-muted">
          {video.summarisedAt
            ? 'The description says too little to summarise, and there is no transcript yet.'
            : 'Not summarised yet. The next scheduled run writes it.'}
        </p>
      </section>
    );
  }
  const note = summaryNote(video);
  return (
    <section>
      <h2 className="mb-1 text-ui font-semibold text-ink-muted">Summary</h2>
      <p className="text-body text-ink">{video.summary}</p>
      {note && <p className="mt-1 text-small text-ink-muted">{note}</p>}
      {video.keyPoints.length > 0 && (
        <>
          <h2 className="mb-1 mt-4 text-ui font-semibold text-ink-muted">Key points</h2>
          <ul className="list-disc space-y-1 pl-5 text-body text-ink">
            {video.keyPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
