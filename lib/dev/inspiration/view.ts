import { isModuleId, type ModuleId } from '@/lib/modules';
import { watchAt } from '@/lib/learn/youtube/format';

/**
 * What the Inspiration tab draws (plan #1412), assembled from the rows the
 * loader reads. Pure, so the two views and the "already in the plan" rule are
 * tested without a database.
 *
 * One takeaway can come from several videos: the merge in #1410 moves a
 * repeat's video onto the earlier takeaway. So the one-list view shows each
 * takeaway once with every video under it, and the by-video view shows it
 * under each of its videos, in that video's own wording.
 */

export type TakeawayStatus = 'open' | 'covered' | 'crafted' | 'dismissed';

export type VideoRow = {
  id: string;
  video_id: string;
  title: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  playlist_position: number | null;
  added_at: string;
  left_playlist_at: string | null;
  transcript_state: string;
  transcript_error: string | null;
  processed_at: string | null;
  takeaway_count: number | null;
  process_error: string | null;
};

export type TakeawayRowData = {
  id: string;
  title: string;
  body: string;
  module: string | null;
  status: string;
  idea_id: string | null;
  plan_item_id: string | null;
  created_at: string;
};

export type LinkRow = {
  takeaway_id: string;
  video_id: string;
  said: string | null;
  quote: string | null;
  start_seconds: number | null;
};

export type SettingsRow = {
  youtube_playlist_id: string | null;
  playlist_read_at: string | null;
  playlist_error: string | null;
};

/** One video a takeaway came from, with what that video said and where. */
export type TakeawaySource = {
  /** The inspiration_videos row. */
  videoRowId: string;
  /** The 11-character YouTube id. */
  videoId: string;
  videoTitle: string;
  channel: string | null;
  said: string | null;
  quote: string | null;
  startSeconds: number | null;
  /** Opens the video at the quoted moment, or at the start when there is none. */
  href: string;
};

/**
 * Where a takeaway already stands in the plan. A feature number when there is
 * one, through the idea when the takeaway was matched to an idea that has
 * since been shaped; an idea alone when it has not.
 */
export type TakeawayCover =
  | { kind: 'plan'; number: number }
  | { kind: 'idea'; ideaId: string }
  | null;

export type Takeaway = {
  id: string;
  title: string;
  body: string;
  module: ModuleId | null;
  status: TakeawayStatus;
  createdAt: string;
  cover: TakeawayCover;
  sources: TakeawaySource[];
};

export type InspirationVideo = {
  id: string;
  videoId: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string;
  addedAt: string;
  leftPlaylist: boolean;
  /** What happened when Dash went to read it, in words for the row. */
  state: VideoState;
  /** Its takeaways that are not dismissed, each in this video's own wording. */
  takeaways: Takeaway[];
};

export type VideoState =
  | { kind: 'waiting' }
  | { kind: 'no-transcript'; detail: string | null }
  | { kind: 'failed'; detail: string | null }
  | { kind: 'read'; count: number };

export type InspirationPage = {
  playlistId: string | null;
  playlistReadAt: string | null;
  playlistError: string | null;
  videos: InspirationVideo[];
  /** Every takeaway not dismissed, once each, newest first. */
  list: Takeaway[];
  /** Dismissed takeaways, newest first, for the fold. */
  dismissed: Takeaway[];
};

const STATUSES: readonly TakeawayStatus[] = ['open', 'covered', 'crafted', 'dismissed'];

function statusOf(value: string): TakeawayStatus {
  return (STATUSES as readonly string[]).includes(value) ? (value as TakeawayStatus) : 'open';
}

function videoState(row: VideoRow): VideoState {
  if (row.process_error) return { kind: 'failed', detail: row.process_error };
  if (row.transcript_state === 'failed') return { kind: 'failed', detail: row.transcript_error };
  if (row.transcript_state === 'none') return { kind: 'no-transcript', detail: row.transcript_error };
  if (row.processed_at) return { kind: 'read', count: row.takeaway_count ?? 0 };
  return { kind: 'waiting' };
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

export function buildInspirationPage(input: {
  settings: SettingsRow | null;
  videos: VideoRow[];
  takeaways: TakeawayRowData[];
  links: LinkRow[];
  /** plan_items.number by id, for every plan item the takeaways and ideas name. */
  planNumbers: ReadonlyMap<string, number>;
  /** ideas.plan_item_id by idea id, for every idea the takeaways name. */
  ideaPlanItems: ReadonlyMap<string, string | null>;
}): InspirationPage {
  const videoById = new Map(input.videos.map((video) => [video.id, video]));

  const linksByTakeaway = new Map<string, LinkRow[]>();
  for (const link of input.links) {
    if (!videoById.has(link.video_id)) continue;
    const list = linksByTakeaway.get(link.takeaway_id) ?? [];
    list.push(link);
    linksByTakeaway.set(link.takeaway_id, list);
  }

  const sourceOf = (link: LinkRow): TakeawaySource => {
    const video = videoById.get(link.video_id)!;
    return {
      videoRowId: video.id,
      videoId: video.video_id,
      videoTitle: video.title ?? video.video_id,
      channel: video.channel_title,
      said: link.said,
      quote: link.quote,
      startSeconds: link.start_seconds,
      href: watchAt(video.video_id, link.start_seconds ?? 0),
    };
  };

  const coverOf = (row: TakeawayRowData): TakeawayCover => {
    if (row.plan_item_id) {
      const number = input.planNumbers.get(row.plan_item_id);
      if (number !== undefined) return { kind: 'plan', number };
    }
    if (row.idea_id) {
      const planItem = input.ideaPlanItems.get(row.idea_id);
      const number = planItem ? input.planNumbers.get(planItem) : undefined;
      if (number !== undefined) return { kind: 'plan', number };
      return { kind: 'idea', ideaId: row.idea_id };
    }
    return null;
  };

  const takeaways: Takeaway[] = input.takeaways.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    module: row.module && isModuleId(row.module) ? row.module : null,
    status: statusOf(row.status),
    createdAt: row.created_at,
    cover: coverOf(row),
    sources: (linksByTakeaway.get(row.id) ?? []).map(sourceOf),
  }));

  const shown = takeaways.filter((takeaway) => takeaway.status !== 'dismissed').sort(newestFirst);
  const dismissed = takeaways.filter((takeaway) => takeaway.status === 'dismissed').sort(newestFirst);

  // The by-video view: each video's takeaways, with that video alone as the
  // source, so its row quotes what this video said rather than the merged one.
  const underVideo = new Map<string, Takeaway[]>();
  for (const takeaway of shown) {
    for (const source of takeaway.sources) {
      const list = underVideo.get(source.videoRowId) ?? [];
      list.push({ ...takeaway, sources: [source] });
      underVideo.set(source.videoRowId, list);
    }
  }

  // Playlist order for what is still on it, then what was taken off, newest
  // first. A video with no position sorts after the ones with one.
  const videos = [...input.videos]
    .sort((a, b) => {
      const left = Number(a.left_playlist_at !== null) - Number(b.left_playlist_at !== null);
      if (left !== 0) return left;
      const pa = a.playlist_position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.playlist_position ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return b.added_at.localeCompare(a.added_at);
    })
    .map(
      (row): InspirationVideo => ({
        id: row.id,
        videoId: row.video_id,
        title: row.title ?? row.video_id,
        channel: row.channel_title,
        durationSeconds: row.duration_seconds,
        thumbnailUrl: row.thumbnail_url ?? `https://i.ytimg.com/vi/${row.video_id}/mqdefault.jpg`,
        addedAt: row.added_at,
        leftPlaylist: row.left_playlist_at !== null,
        state: videoState(row),
        takeaways: underVideo.get(row.id) ?? [],
      }),
    );

  return {
    playlistId: input.settings?.youtube_playlist_id ?? null,
    playlistReadAt: input.settings?.playlist_read_at ?? null,
    playlistError: input.settings?.playlist_error ?? null,
    videos,
    list: shown,
    dismissed,
  };
}

/** The two arrangements, as the page's `view` search parameter. */
export const INSPIRATION_VIEWS = ['videos', 'list'] as const;
export type InspirationViewName = (typeof INSPIRATION_VIEWS)[number];

export const INSPIRATION_VIEW_LABEL: Record<InspirationViewName, string> = {
  videos: 'By video',
  list: 'One list',
};

export function parseInspirationView(value: string | string[] | undefined): InspirationViewName {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'list' ? 'list' : 'videos';
}

/** 2 Oct, or 2 Oct 2025 when it is not this year. UTC, so server and test agree. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}
