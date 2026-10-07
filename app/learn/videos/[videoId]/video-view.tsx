import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ClipPlayer } from '@/components/learn/clip-player';
import { clockTime, durationLabel } from '@/lib/learn/youtube/format';
import {
  PILE_LABEL,
  VERDICTS,
  verdictReason,
  type ListVideoPage,
  type RelatedIdea,
  type VideoCard,
} from '@/lib/learn/youtube/videos';
import { Button } from '@/components/ui/button';
import { moveVideoAction } from '../actions';
import { addedLabel } from '../video-rows';
import { WatchedToggle } from '../watched-toggle';

/**
 * One video on your list (plan #1069): the player, and beside it the summary,
 * the key points and the ideas of yours it is closest to.
 *
 * `?t=` is where the player starts. A chapter is a link that sets it, the same
 * as a transcript line on the library's video page, so a chapter works before
 * JavaScript does (law 6) and a moment is a URL. With no `?t=`, a video in
 * the Watch pile starts at its best minute (#1068).
 */
export type ListVideoViewProps = {
  video: ListVideoPage;
  /** Where the player starts, in seconds. */
  start: number;
  cards: VideoCard[];
  /** The ideas of yours it is closest to; null when finding them failed. */
  related: RelatedIdea[] | null;
  relatedError: string | null;
};

export function ListVideoView({ video, start, cards, related, relatedError }: ListVideoViewProps) {
  const meta = [
    video.channel,
    durationLabel(video.durationSeconds),
    video.foundFor ? `found for ${video.foundFor}` : null,
    `added ${addedLabel(video.addedAt)}`,
    video.leftPlaylistAt ? 'no longer on the playlist' : null,
  ].filter(Boolean);

  return (
    <>
      <p className="mb-3">
        <Link href="/learn/videos" className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink">
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
                      className="press-area w-14 shrink-0 text-right tabular-nums text-ink-muted hover:text-accent"
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
          <Pile video={video} cards={cards} />
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

/**
 * Which pile the video is in and why (#1068), with the stretch to watch or
 * the cards it became, and the buttons that move it. A plain form, so a move
 * works before JavaScript does (law 6).
 */
function Pile({ video, cards }: { video: ListVideoPage; cards: VideoCard[] }) {
  return (
    <section>
      <h2 className="mb-1 text-ui font-semibold text-ink-muted">{PILE_LABEL[video.verdict ?? 'unjudged']}</h2>
      <p className="text-ui text-ink">{verdictReason(video)}</p>
      {video.verdict === 'watch' && (
        <p className="mt-1 text-ui">
          {video.bestStartSeconds !== null ? (
            <Link
              href={`/learn/videos/${video.videoId}?t=${video.bestStartSeconds}`}
              scroll={false}
              className="tabular-nums text-accent hover:underline"
            >
              Best stretch {clockTime(video.bestStartSeconds)}
              {video.bestEndSeconds !== null && ` to ${clockTime(video.bestEndSeconds)}`}
            </Link>
          ) : (
            <span className="text-ink-muted">No best stretch was picked, so it plays from the start.</span>
          )}
        </p>
      )}
      {video.verdict === 'card' && <Cards video={video} cards={cards} />}
      <form action={moveVideoAction} className="mt-2 flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="videoId" value={video.videoId} />
        <span className="text-small text-ink-muted">Move to</span>
        {VERDICTS.filter((verdict) => verdict !== video.verdict).map((verdict) => (
          <Button key={verdict} type="submit" name="verdict" value={verdict} size="sm" variant="secondary">
            {PILE_LABEL[verdict]}
          </Button>
        ))}
      </form>
    </section>
  );
}

function Cards({ video, cards }: { video: ListVideoPage; cards: VideoCard[] }) {
  if (cards.length === 0) {
    return (
      <p id="cards" className="mt-1 text-small text-ink-muted">
        {video.stretchCount > 0
          ? 'Its cards are written on the next hourly run of the feed on Now.'
          : 'No cards: the judge marked no part of it to make a card from, so move it to Watch if you want it kept.'}
      </p>
    );
  }
  return (
    <div id="cards" className="mt-2">
      <h3 className="mb-1 text-small font-semibold text-ink-muted">
        {cards.length === 1 ? 'The card it became' : `The ${cards.length} cards it became`}
      </h3>
      <ul className="space-y-1">
        {cards.map((card) => (
          <li key={card.id} className="flex gap-3 text-ui">
            <Link
              href={`/learn/videos/${video.videoId}?t=${card.startSeconds}`}
              scroll={false}
              className="press-area w-14 shrink-0 text-right tabular-nums text-ink-muted hover:text-accent"
            >
              {clockTime(card.startSeconds)}
            </Link>
            {card.conceptId ? (
              <Link href={`/learn/c/${card.conceptId}`} className="press-area min-w-0 text-ink hover:underline">
                {card.title}
              </Link>
            ) : (
              <span className="min-w-0 text-ink">{card.title}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
