import 'server-only';

import { z } from 'zod';
import { fetchDocument } from './fetch';

/**
 * YouTube, for metadata and published order.
 *
 * docs/LEARN-SOURCES-SPEC.md splits a lecture course in two, and this module
 * is the half that has an API. Titles, durations and above all the order the
 * institution published its lectures in come from the Data API. The words
 * spoken in a lecture do not: `captions.download` needs an OAuth token from
 * the account that owns the video and answers 403 for anything else, so
 * transcripts come from the institution's own site and reach this catalogue
 * through the port in lib/learn/catalogue/sweep.ts.
 *
 * **Playlists, never search.** `search.list` costs 100 quota units against a
 * 10,000-unit daily default, which is a hundred calls a day.
 * `playlistItems.list` and `videos.list` cost 1 each, and a playlist is where
 * the published order lives anyway. Walking one course of forty lectures is
 * three calls.
 *
 * Everything the API answers is parsed by a pure function below, so the
 * shapes that matter -- a playlist that does not exist, a lecture deleted out
 * of the middle of a course, a duration in a format nobody expected -- are
 * testable without a key and without a network.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3/';
const WATCH_BASE = 'https://www.youtube.com/watch';
const PLAYLIST_BASE = 'https://www.youtube.com/playlist';

/** The API's own page size, and the most ids `videos.list` takes at once. */
const PAGE_SIZE = 50;
/** 1,000 videos. A course is forty; this is the runaway guard, not a limit. */
const MAX_PAGES = 20;

export type YouTubeChapter = {
  startSeconds: number;
  title: string;
};

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  canonicalUrl: string;
  durationSeconds: number | null;
  /** ISO date, which is what `catalogue_items.published_at` takes. */
  publishedAt: string | null;
};

export type YouTubePlaylist = {
  playlistId: string;
  title: string;
  description: string;
  canonicalUrl: string;
  /** What fills `catalogue_providers.youtube_channel_id`, from the API. */
  channelId: string | null;
  channelTitle: string | null;
  /** In the order the playlist publishes them. */
  videos: YouTubeVideo[];
};

export type YouTubeFailure = {
  ok: false;
  /**
   * `no-key` is the setup step not done. `quota` is the 403 that both an
   * exhausted quota and a key restricted to another referrer return, and the
   * two are not distinguishable from the status alone. `not-found` is an
   * ordinary answer to a playlist id typed by hand.
   */
  reason: 'no-key' | 'not-found' | 'quota' | 'blocked' | 'error';
  detail: string;
};

export type YouTubePlaylistResult = ({ ok: true } & YouTubePlaylist) | YouTubeFailure;

function fail(reason: YouTubeFailure['reason'], detail: string): YouTubeFailure {
  return { ok: false, reason, detail };
}

export function watchUrl(videoId: string): string {
  const url = new URL(WATCH_BASE);
  url.searchParams.set('v', videoId);
  return url.toString();
}

export function playlistUrl(playlistId: string): string {
  const url = new URL(PLAYLIST_BASE);
  url.searchParams.set('list', playlistId);
  return url.toString();
}

/** The three request shapes, exported so the tests can read them. */
export function playlistRequestUrl(playlistId: string, key: string): string {
  const url = new URL('playlists', API_BASE);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', playlistId);
  url.searchParams.set('key', key);
  return url.toString();
}

export function playlistItemsRequestUrl(
  playlistId: string,
  key: string,
  pageToken?: string,
): string {
  const url = new URL('playlistItems', API_BASE);
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  url.searchParams.set('key', key);
  return url.toString();
}

export function videosRequestUrl(videoIds: string[], key: string): string {
  const url = new URL('videos', API_BASE);
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  url.searchParams.set('key', key);
  return url.toString();
}

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * `PT1H23M45S` in seconds.
 *
 * Null rather than zero for anything unparseable, and for the `P0D` the API
 * returns for a live stream that never ended: `catalogue_items` refuses a
 * duration of zero, and a wrong number is worse than an absent one in the
 * length fit the spec ranks by.
 */
export function parseIsoDuration(value: string): number | null {
  const match = ISO_DURATION.exec(value.trim());
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Math.round(Number(seconds ?? 0));

  return total > 0 ? total : null;
}

const TIMESTAMP = /^(?:(\d{1,3}):)?(\d{1,3}):(\d{2})$/;

function parseTimestamp(value: string): number | null {
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  const parsed = Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(parsed) ? parsed : null;
}

const CHAPTER_LINE = /^[\s\-*•]*\(?((?:\d{1,3}:)?\d{1,3}:\d{2})\)?\s*[-–—:.)\]]*\s*(\S.*)$/;

/** YouTube's own rules for when a description is a chapter list. */
const MIN_CHAPTERS = 3;
const MIN_CHAPTER_SECONDS = 10;

/**
 * The chapter markers a video publishes in its own description.
 *
 * Where a lecture has these, a human has already decided where the seams are,
 * and the spec says to use them as segment boundaries rather than cutting at a
 * fixed length. They are also the only timed boundaries available without the
 * institution's transcript, which makes them worth reading even when the
 * chapter title is all the text a segment gets.
 *
 * YouTube's own conditions are applied rather than a looser guess, because a
 * description that happens to mention "see 4:32" is not a chapter list: the
 * first marker is at zero, there are at least three, they ascend, and none is
 * shorter than ten seconds. A description that fails any of them yields
 * nothing and the caller falls back to one segment for the whole video.
 */
export function chaptersFromDescription(description: string): YouTubeChapter[] {
  const found: YouTubeChapter[] = [];

  for (const line of description.split('\n')) {
    const match = CHAPTER_LINE.exec(line);
    if (!match) continue;
    const startSeconds = parseTimestamp(match[1]);
    if (startSeconds === null) continue;
    const title = match[2].trim();
    if (!title) continue;
    found.push({ startSeconds, title });
  }

  if (found.length < MIN_CHAPTERS) return [];
  if (found[0].startSeconds !== 0) return [];

  for (let i = 1; i < found.length; i += 1) {
    if (found[i].startSeconds - found[i - 1].startSeconds < MIN_CHAPTER_SECONDS) return [];
  }

  return found;
}

const LECTURE_LABEL =
  /^\s*((?:lecture|lec|unit|session|part|week|class|chapter)\s*\.?\s*\d+(?:\.\d+)?)/i;

/**
 * The provider's own numbering, taken from the lecture's title.
 *
 * `catalogue_course_items.provider_label` wants it verbatim -- `Lecture 7`,
 * not a seventh position restated -- because that is what somebody reading a
 * syllabus is looking for. A title that does not open with a number gets null
 * rather than an invented one; the position is already stored beside it and
 * says everything an invented label would.
 */
export function lectureLabel(title: string): string | null {
  const match = LECTURE_LABEL.exec(title);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim();
}

const PlaylistSnippet = z.object({
  title: z.string(),
  description: z.string().optional(),
  channelId: z.string().optional(),
  channelTitle: z.string().optional(),
});

const PlaylistResponse = z.object({
  error: z.object({ message: z.string() }).optional(),
  items: z.array(z.object({ id: z.string(), snippet: PlaylistSnippet.optional() })).optional(),
});

export type PlaylistHead = {
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string | null;
};

export type PlaylistHeadResult = ({ ok: true } & PlaylistHead) | YouTubeFailure;

export function parsePlaylistResponse(body: string): PlaylistHeadResult {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail('error', 'the API answered with something that is not JSON');
  }

  const parsed = PlaylistResponse.safeParse(payload);
  if (!parsed.success) return fail('error', 'the API answered in an unexpected shape');
  if (parsed.data.error) return fail('error', parsed.data.error.message);

  const item = parsed.data.items?.[0];
  if (!item?.snippet) return fail('not-found', 'no playlist with that id');

  return {
    ok: true,
    title: item.snippet.title,
    description: item.snippet.description ?? '',
    channelId: item.snippet.channelId ?? null,
    channelTitle: item.snippet.channelTitle ?? null,
  };
}

const ItemsResponse = z.object({
  error: z.object({ message: z.string() }).optional(),
  nextPageToken: z.string().optional(),
  items: z
    .array(z.object({ contentDetails: z.object({ videoId: z.string() }).optional() }))
    .optional(),
});

export type PlaylistPage = { videoIds: string[]; nextPageToken: string | null };
export type PlaylistPageResult = ({ ok: true } & PlaylistPage) | YouTubeFailure;

/**
 * One page of a playlist, in playlist order.
 *
 * An entry with no `videoId` is a lecture that has been deleted out of the
 * middle of a course. It is dropped here rather than stored as a gap, and the
 * positions written later are contiguous, because the ordering is what the
 * course is for and a hole in it teaches nobody anything.
 */
export function parsePlaylistItemsPage(body: string): PlaylistPageResult {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail('error', 'the API answered with something that is not JSON');
  }

  const parsed = ItemsResponse.safeParse(payload);
  if (!parsed.success) return fail('error', 'the API answered in an unexpected shape');
  if (parsed.data.error) return fail('error', parsed.data.error.message);

  const videoIds: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed.data.items ?? []) {
    const id = item.contentDetails?.videoId;
    if (typeof id !== 'string' || id.trim() === '') continue;
    // A playlist may list the same lecture twice -- a recap, or a mistake.
    // Only its first place in the order is kept, because
    // `catalogue_course_items` holds one row per member and the first place is
    // where the course actually teaches it.
    if (seen.has(id)) continue;
    seen.add(id);
    videoIds.push(id);
  }

  return { ok: true, videoIds, nextPageToken: parsed.data.nextPageToken ?? null };
}

const VideosResponse = z.object({
  error: z.object({ message: z.string() }).optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z
          .object({
            title: z.string(),
            description: z.string().optional(),
            publishedAt: z.string().optional(),
          })
          .optional(),
        contentDetails: z.object({ duration: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export type VideosResult = ({ ok: true; videos: YouTubeVideo[] }) | YouTubeFailure;

/**
 * The videos a batch of ids describes.
 *
 * Returned unordered, keyed by id by the caller: `videos.list` makes no
 * promise about the order of its answer, and the order that matters is the
 * playlist's. An id the API does not answer for is a private or deleted
 * video, and it simply does not appear.
 */
export function parseVideosResponse(body: string): VideosResult {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail('error', 'the API answered with something that is not JSON');
  }

  const parsed = VideosResponse.safeParse(payload);
  if (!parsed.success) return fail('error', 'the API answered in an unexpected shape');
  if (parsed.data.error) return fail('error', parsed.data.error.message);

  const videos: YouTubeVideo[] = [];
  for (const item of parsed.data.items ?? []) {
    if (!item.snippet) continue;
    const duration = item.contentDetails?.duration;
    videos.push({
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description ?? '',
      canonicalUrl: watchUrl(item.id),
      durationSeconds: duration ? parseIsoDuration(duration) : null,
      publishedAt: item.snippet.publishedAt?.slice(0, 10) ?? null,
    });
  }

  return { ok: true, videos };
}

/**
 * The one place a fetch failure becomes something this module's caller can
 * say out loud.
 *
 * 403 is the interesting one: an exhausted daily quota and a key restricted to
 * somebody else's referrer both answer with it, and the status alone does not
 * say which. Both are the person's to fix and neither is a broken playlist,
 * which is the distinction the sweep prints.
 */
function fromFetchFailure(reason: string, detail: string): YouTubeFailure {
  if (reason === 'not-found') return fail('not-found', detail);
  if (reason === 'blocked') return fail('blocked', detail);
  if (detail === '403') return fail('quota', 'the API answered 403: quota spent, or the key is restricted');
  if (detail === '400') return fail('error', 'the API answered 400, which usually means YOUTUBE_API_KEY is not a usable key');
  return fail('error', `${reason}: ${detail}`);
}

async function getJson(url: string): Promise<{ ok: true; text: string } | YouTubeFailure> {
  const fetched = await fetchDocument(url);
  if (!fetched.ok) return fromFetchFailure(fetched.reason, fetched.detail);
  if (fetched.contentType !== 'json') return fail('error', `expected JSON, got ${fetched.contentType}`);
  return { ok: true, text: fetched.text };
}

function youTubeKey(): string | YouTubeFailure {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  return key ? key : fail('no-key', 'YOUTUBE_API_KEY is not set');
}

export type PlaylistOrderOptions = {
  /**
   * Stop at the first id in this set, without including it. For an uploads
   * playlist, which lists newest first, this is every video already stored,
   * so a re-list reads only what is new and usually costs one quota unit.
   */
  stopAt?: Set<string>;
  /** The runaway guard, in pages of fifty. */
  maxPages?: number;
};

/**
 * The video ids of a playlist, in its own order, one quota unit per fifty.
 */
export async function fetchPlaylistVideoIds(
  playlistId: string,
  options: PlaylistOrderOptions = {},
): Promise<({ ok: true; videoIds: string[]; complete: boolean }) | YouTubeFailure> {
  const key = youTubeKey();
  if (typeof key !== 'string') return key;

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  const maxPages = options.maxPages ?? MAX_PAGES;

  for (let page = 0; page < maxPages; page += 1) {
    const body = await getJson(playlistItemsRequestUrl(playlistId, key, pageToken));
    if (!body.ok) return body;
    const parsed = parsePlaylistItemsPage(body.text);
    if (!parsed.ok) return parsed;

    for (const id of parsed.videoIds) {
      if (options.stopAt?.has(id)) return { ok: true, videoIds: orderedIds, complete: true };
      if (seen.has(id)) continue;
      seen.add(id);
      orderedIds.push(id);
    }
    if (!parsed.nextPageToken) return { ok: true, videoIds: orderedIds, complete: true };
    pageToken = parsed.nextPageToken;
  }

  return { ok: true, videoIds: orderedIds, complete: false };
}

/**
 * Title, description, duration and date for a list of ids, in batches of
 * fifty at one quota unit each. Private and deleted videos do not come back;
 * the order of the answer is not the order asked for.
 */
export async function fetchVideosByIds(
  videoIds: string[],
): Promise<({ ok: true; videos: YouTubeVideo[] }) | YouTubeFailure> {
  const key = youTubeKey();
  if (typeof key !== 'string') return key;

  const videos: YouTubeVideo[] = [];
  for (let from = 0; from < videoIds.length; from += PAGE_SIZE) {
    const batch = videoIds.slice(from, from + PAGE_SIZE);
    const body = await getJson(videosRequestUrl(batch, key));
    if (!body.ok) return body;
    const parsed = parseVideosResponse(body.text);
    if (!parsed.ok) return parsed;
    videos.push(...parsed.videos);
  }
  return { ok: true, videos };
}

/**
 * Walk one playlist into a course.
 *
 * Three kinds of call and no search: the playlist itself for its title and its
 * channel, its items for the order, and the videos in batches of fifty for
 * durations and descriptions. A forty-lecture course costs three quota units
 * of ten thousand.
 */
export async function fetchYouTubePlaylist(playlistId: string): Promise<YouTubePlaylistResult> {
  const wanted = playlistId.trim();
  if (!wanted) return fail('error', 'no playlist named');

  const key = youTubeKey();
  if (typeof key !== 'string') return key;

  const headBody = await getJson(playlistRequestUrl(wanted, key));
  if (!headBody.ok) return headBody;
  const head = parsePlaylistResponse(headBody.text);
  if (!head.ok) return head;

  const order = await fetchPlaylistVideoIds(wanted);
  if (!order.ok) return order;
  const orderedIds = order.videoIds;

  if (orderedIds.length === 0) return fail('not-found', `${head.title} has no videos in it`);

  const found = await fetchVideosByIds(orderedIds);
  if (!found.ok) return found;
  const byId = new Map(found.videos.map((video) => [video.videoId, video]));

  const videos = orderedIds
    .map((id) => byId.get(id))
    .filter((video): video is YouTubeVideo => video !== undefined);

  if (videos.length === 0) return fail('not-found', `nothing in ${head.title} is still watchable`);

  return {
    ok: true,
    playlistId: wanted,
    title: head.title,
    description: head.description,
    canonicalUrl: playlistUrl(wanted),
    channelId: head.channelId,
    channelTitle: head.channelTitle,
    videos,
  };
}

// ---------------------------------------------------------------------------
// Channels.
//
// A channel you follow is listed in full and for free: `channels.list` for its
// uploads playlist, `playlistItems.list` over that for every video, and
// `playlists.list` for how the channel itself groups them. Each is one quota
// unit per call, so a channel of two thousand videos costs about eighty units
// the first time and one or two on each re-list after.
// ---------------------------------------------------------------------------

export type ChannelInput =
  | { ok: true; handle: string }
  | { ok: true; channelId: string }
  | { ok: false; error: string };

const HANDLE = /^@[A-Za-z0-9._-]{1,100}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * A channel as somebody would paste it: `@MITOCW`, a link to the channel
 * page, or a `UC...` channel id.
 */
export function parseChannelInput(raw: string): ChannelInput {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Paste a channel handle like @MITOCW, or a link to the channel.' };

  if (HANDLE.test(trimmed)) return { ok: true, handle: trimmed };
  if (CHANNEL_ID.test(trimmed)) return { ok: true, channelId: trimmed };
  if (/^[A-Za-z0-9._-]{3,100}$/.test(trimmed) && !trimmed.startsWith('UC')) {
    return { ok: true, handle: `@${trimmed}` };
  }

  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    url = null;
  }
  if (url && /(^|\.)youtube\.com$/i.test(url.hostname)) {
    const [first, second] = url.pathname.split('/').filter(Boolean);
    if (first && HANDLE.test(decodeURIComponent(first))) return { ok: true, handle: decodeURIComponent(first) };
    if (first === 'channel' && second && CHANNEL_ID.test(second)) return { ok: true, channelId: second };
    if ((first === 'c' || first === 'user') && second) {
      return { ok: false, error: 'That is an old-style channel link. Open the channel and copy its @handle instead.' };
    }
  }

  return { ok: false, error: `${trimmed} does not look like a YouTube channel.` };
}

export function channelsRequestUrl(input: { handle: string } | { channelId: string }, key: string): string {
  const url = new URL('channels', API_BASE);
  url.searchParams.set('part', 'snippet,contentDetails');
  if ('handle' in input) url.searchParams.set('forHandle', input.handle);
  else url.searchParams.set('id', input.channelId);
  url.searchParams.set('key', key);
  return url.toString();
}

export function channelPlaylistsRequestUrl(channelId: string, key: string, pageToken?: string): string {
  const url = new URL('playlists', API_BASE);
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('channelId', channelId);
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  url.searchParams.set('key', key);
  return url.toString();
}

export type YouTubeChannel = {
  channelId: string;
  title: string;
  /** `@MITOCW`. Null for the rare channel that has none. */
  handle: string | null;
  uploadsPlaylistId: string;
  canonicalUrl: string;
};

const ChannelsResponse = z.object({
  error: z.object({ message: z.string() }).optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string(), customUrl: z.string().optional() }).optional(),
        contentDetails: z
          .object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).optional() })
          .optional(),
      }),
    )
    .optional(),
});

export function parseChannelsResponse(body: string): ({ ok: true } & YouTubeChannel) | YouTubeFailure {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail('error', 'the API answered with something that is not JSON');
  }

  const parsed = ChannelsResponse.safeParse(payload);
  if (!parsed.success) return fail('error', 'the API answered in an unexpected shape');
  if (parsed.data.error) return fail('error', parsed.data.error.message);

  const item = parsed.data.items?.[0];
  if (!item?.snippet) return fail('not-found', 'no channel by that name');
  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return fail('not-found', `${item.snippet.title} has no uploads playlist`);

  const custom = item.snippet.customUrl?.trim();
  const handle = custom ? (custom.startsWith('@') ? custom : `@${custom}`) : null;

  return {
    ok: true,
    channelId: item.id,
    title: item.snippet.title,
    handle: handle && HANDLE.test(handle) ? handle : null,
    uploadsPlaylistId: uploads,
    canonicalUrl: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${item.id}`,
  };
}

export type YouTubeChannelPlaylist = {
  playlistId: string;
  title: string;
  description: string;
  itemCount: number | null;
};

const ChannelPlaylistsResponse = z.object({
  error: z.object({ message: z.string() }).optional(),
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string(), description: z.string().optional() }).optional(),
        contentDetails: z.object({ itemCount: z.number().optional() }).optional(),
      }),
    )
    .optional(),
});

export function parseChannelPlaylistsPage(
  body: string,
): ({ ok: true; playlists: YouTubeChannelPlaylist[]; nextPageToken: string | null }) | YouTubeFailure {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail('error', 'the API answered with something that is not JSON');
  }

  const parsed = ChannelPlaylistsResponse.safeParse(payload);
  if (!parsed.success) return fail('error', 'the API answered in an unexpected shape');
  if (parsed.data.error) return fail('error', parsed.data.error.message);

  const playlists: YouTubeChannelPlaylist[] = [];
  for (const item of parsed.data.items ?? []) {
    if (!item.snippet) continue;
    playlists.push({
      playlistId: item.id,
      title: item.snippet.title,
      description: item.snippet.description ?? '',
      itemCount: item.contentDetails?.itemCount ?? null,
    });
  }

  return { ok: true, playlists, nextPageToken: parsed.data.nextPageToken ?? null };
}

/** Resolve a handle or id to the channel and its uploads playlist. One unit. */
export async function fetchYouTubeChannel(
  input: { handle: string } | { channelId: string },
): Promise<({ ok: true } & YouTubeChannel) | YouTubeFailure> {
  const key = youTubeKey();
  if (typeof key !== 'string') return key;

  const body = await getJson(channelsRequestUrl(input, key));
  if (!body.ok) return body;
  return parseChannelsResponse(body.text);
}

/** Every playlist a channel publishes. One unit per fifty. */
export async function fetchChannelPlaylists(
  channelId: string,
): Promise<({ ok: true; playlists: YouTubeChannelPlaylist[] }) | YouTubeFailure> {
  const key = youTubeKey();
  if (typeof key !== 'string') return key;

  const playlists: YouTubeChannelPlaylist[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson(channelPlaylistsRequestUrl(channelId, key, pageToken));
    if (!body.ok) return body;
    const parsed = parseChannelPlaylistsPage(body.text);
    if (!parsed.ok) return parsed;
    playlists.push(...parsed.playlists);
    if (!parsed.nextPageToken) break;
    pageToken = parsed.nextPageToken;
  }
  return { ok: true, playlists };
}
