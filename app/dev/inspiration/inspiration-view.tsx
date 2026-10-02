import Link from 'next/link';
import { Telescope } from 'lucide-react';
import { cardVariants } from '@/components/ui/card';
import { Group, SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { durationLabel } from '@/lib/learn/youtube/format';
import {
  INSPIRATION_VIEWS,
  INSPIRATION_VIEW_LABEL,
  dayLabel,
  type InspirationPage,
  type InspirationVideo,
  type InspirationViewName,
  type Takeaway,
  type VideoState,
} from '@/lib/dev/inspiration/view';
import { PageHeader } from '@/components/shell/page-header';
import { CheckNow } from './check-now';
import { PlaylistSetting } from './playlist-setting';
import { TakeawayRow } from './takeaway-row';

/**
 * The body of the Inspiration tab (plan #1412): the two arrangements of what
 * Dash took from the playlist, and the dismissed ones folded shut under both.
 *
 * Which arrangement is a search parameter, not state, so it survives a
 * refresh and can be linked, the same as the Ideas page's grouping.
 */

function ViewSwitch({ view }: { view: InspirationViewName }) {
  return (
    <span role="group" aria-label="How the takeaways are arranged" className={segmentedFrame}>
      {INSPIRATION_VIEWS.map((option) => {
        const on = option === view;
        return (
          <Link
            key={option}
            href={option === 'videos' ? '/dev/inspiration' : `/dev/inspiration?view=${option}`}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'press inline-flex h-(--control-h) items-center px-2.5 text-ui font-medium',
              'transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2',
              on ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {INSPIRATION_VIEW_LABEL[option]}
          </Link>
        );
      })}
    </span>
  );
}

/** What happened to a video, for a video with nothing listed under it. */
function stateLine(state: VideoState): string {
  switch (state.kind) {
    case 'waiting':
      return 'Not read yet.';
    case 'no-transcript':
      return 'YouTube has no transcript for this video, so Dash could not read it.';
    case 'failed':
      return state.detail ? `Dash could not read this video: ${state.detail}` : 'Dash could not read this video.';
    case 'read':
      return state.count === 0
        ? 'Read. Nothing in it applies to this app.'
        : 'Read. Everything it gave is already an idea, in the plan, or dismissed.';
  }
}

function VideoHeader({ video }: { video: InspirationVideo }) {
  const watch = `https://www.youtube.com/watch?v=${video.videoId}`;
  const meta = [
    video.channel,
    durationLabel(video.durationSeconds),
    `added ${dayLabel(video.addedAt)}`,
    video.leftPlaylist ? 'taken off the playlist' : null,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-3">
      <a href={watch} target="_blank" rel="noreferrer" className="shrink-0" tabIndex={-1} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own stills, not worth the image optimiser */}
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          width={96}
          height={54}
          className="h-[54px] w-24 rounded-sm bg-sunken object-cover"
        />
      </a>
      <div className="min-w-0 flex-1">
        <h2 className="text-ui font-semibold text-ink">
          <a href={watch} target="_blank" rel="noreferrer" className="line-clamp-2 hover:underline">
            {video.title}
          </a>
        </h2>
        <p className="truncate text-small tabular-nums text-ink-muted">{meta.join(' · ')}</p>
      </div>
    </div>
  );
}

function VideoGroup({ video }: { video: InspirationVideo }) {
  return (
    <Group>
      <VideoHeader video={video} />
      {video.summary.length > 0 && (
        <ul aria-label="What the video says" className="list-disc space-y-0.5 pl-5 text-small text-ink-muted">
          {video.summary.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      )}
      {video.takeaways.length > 0 ? (
        <ul className={cn(cardVariants(), 'divide-y divide-border')}>
          {video.takeaways.map((takeaway) => (
            <TakeawayRow key={takeaway.id} takeaway={takeaway} inVideo />
          ))}
        </ul>
      ) : (
        <p className="text-small text-ink-muted">{stateLine(video.state)}</p>
      )}
    </Group>
  );
}

function TakeawayList({ takeaways }: { takeaways: Takeaway[] }) {
  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border')}>
      {takeaways.map((takeaway) => (
        <TakeawayRow key={takeaway.id} takeaway={takeaway} />
      ))}
    </ul>
  );
}

export function InspirationView({ page, view }: { page: InspirationPage; view: InspirationViewName }) {
  if (page.videos.length === 0) {
    return page.playlistId ? (
      <EmptyState
        icon={Telescope}
        title="The playlist has not been read yet"
        description="Once Dash reads it, each video shows here with the ideas it took from it for this app."
      />
    ) : (
      <EmptyState
        icon={Telescope}
        title="No playlist set"
        description="Paste the link to a YouTube playlist above, and Dash reads each video in it for ideas for this app."
      />
    );
  }

  const read = page.videos.filter((video) => video.state.kind === 'read').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewSwitch view={view} />
        <p className="tabular text-small text-ink-muted">
          {page.list.length} {page.list.length === 1 ? 'takeaway' : 'takeaways'} from {read} of{' '}
          {page.videos.length} {page.videos.length === 1 ? 'video' : 'videos'} read
        </p>
      </div>

      {view === 'videos' ? (
        <div className="space-y-6">
          {page.videos.map((video) => (
            <VideoGroup key={video.id} video={video} />
          ))}
        </div>
      ) : page.list.length > 0 ? (
        <TakeawayList takeaways={page.list} />
      ) : (
        <p className="text-small text-ink-muted">
          No takeaways yet. They show here as Dash reads the videos.
        </p>
      )}

      {page.filed.length > 0 && (
        <SectionFold title="Already an idea or in the plan" count={page.filed.length} defaultOpen={false}>
          <TakeawayList takeaways={page.filed} />
        </SectionFold>
      )}

      {page.dismissed.length > 0 && (
        <SectionFold title="Dismissed" count={page.dismissed.length} defaultOpen={false}>
          <TakeawayList takeaways={page.dismissed} />
        </SectionFold>
      )}
    </div>
  );
}

/**
 * The whole page: the heading, which playlist it reads and when, then the
 * takeaways. Apart from the route so the surface gallery draws the same thing
 * from fixtures.
 */
export function InspirationScreen({ page, view }: { page: InspirationPage; view: InspirationViewName }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <PageHeader
          title="Inspiration"
          description="Ideas for this app that Dash took from the videos in your playlist."
          actions={page.playlistId ? <CheckNow checking={page.checking} /> : undefined}
        />
        <div className="-mt-3 space-y-1">
          <PlaylistSetting playlistId={page.playlistId} />
          {page.playlistId && (
            <p className="text-small text-ink-muted">
              {page.playlistReadAt ? `Last read ${dayLabel(page.playlistReadAt)}.` : 'Not read yet.'}
            </p>
          )}
          {page.playlistError && (
            <p role="alert" className="text-small text-caution">
              The last read failed: {page.playlistError}
            </p>
          )}
        </div>
      </div>
      <InspirationView page={page} view={view} />
    </div>
  );
}
