import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  fetchChannelPlaylists,
  fetchPlaylistVideoIds,
  fetchVideosByIds,
  fetchYouTubeChannel,
  lectureLabel,
  parseChannelInput,
  playlistUrl,
  type YouTubeChannel,
  type YouTubeChannelPlaylist,
  type YouTubeVideo,
} from '@/lib/learn/providers/youtube';
import { queueTranscripts } from './transcripts';

/**
 * The channels you follow, stored in the catalogue for free.
 *
 * A channel is a row of `catalogue_providers`, each of its videos a
 * `catalogue_items` row of kind `video`, and each of its playlists an item of
 * kind `course` with its videos in order in `catalogue_course_items`. That is
 * the shape the course sweep already writes, so a playlist listed here and a
 * playlist pulled as a course are the same rows.
 *
 * Listing costs YouTube Data API quota and nothing else: 10,000 units a day,
 * one unit per fifty videos or playlists. Nothing here fetches a transcript.
 * A listed video has no segments until one is asked for, and everything in
 * Learn that searches the catalogue reads segments, so a listed video is
 * invisible to it until then.
 *
 * Written through the service-role client over HTTPS, like the Learn now pass,
 * so it needs no direct database connection.
 */

/** Uploads read on a channel's first listing: 5,000 videos, 100 quota units. */
const MAX_UPLOAD_PAGES = 100;

/** PostgREST answers at most this many rows per request. */
const PAGE_ROWS = 1000;

/** Rows per upsert request. */
const WRITE_BATCH = 200;

/** Playlists are re-walked when they were last listed this long ago. */
const PLAYLIST_REFRESH_MS = 7 * 86_400_000;

const MAX_DESCRIPTION = 5000;

export type ChannelRow = {
  id: string;
  slug: string;
  name: string;
  youtube_channel_id: string;
  youtube_handle: string | null;
  youtube_uploads_playlist_id: string | null;
  youtube_listed_at: string | null;
  auto_transcribe: boolean;
};

const CHANNEL_COLUMNS =
  'id, slug, name, youtube_channel_id, youtube_handle, youtube_uploads_playlist_id, youtube_listed_at, auto_transcribe';

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** `@MITOCW` as a provider slug: `mitocw`. */
export function slugForChannel(channel: Pick<YouTubeChannel, 'handle' | 'title' | 'channelId'>): string {
  const base = (channel.handle?.slice(1) ?? channel.title)
    .toLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return base.length >= 2 ? base : `yt-${channel.channelId.slice(2, 12).toLowerCase()}`;
}

/**
 * The seeded provider this channel is, if any.
 *
 * 0022 seeded MIT OpenCourseWare, Khan Academy, TED and the others before any
 * of them had a channel id. Adding `@MITOCW` should fill in `mit-ocw` rather
 * than create a second MIT, because the OCW transcript adapter is keyed on
 * that slug. Matched on the name or slug with everything but letters and
 * digits removed, so `YaleCourses` finds `yale-courses`.
 */
export function matchSeededProvider(
  channel: Pick<YouTubeChannel, 'handle' | 'title'>,
  seeded: { id: string; slug: string; name: string }[],
): string | null {
  const keys = new Set([normalise(channel.title), channel.handle ? normalise(channel.handle) : ''].filter(Boolean));
  const match = seeded.find((row) => keys.has(normalise(row.name)) || keys.has(normalise(row.slug)));
  return match?.id ?? null;
}

export type AddChannelResult =
  | { ok: true; channel: ChannelRow; created: boolean }
  | { ok: false; error: string };

/**
 * Resolve a pasted channel and make it a provider. Lists nothing; the caller
 * lists it next, so a slow first listing does not lose the channel.
 */
export async function addChannel(learn: LearnSupabaseClient, raw: string): Promise<AddChannelResult> {
  const input = parseChannelInput(raw);
  if (!input.ok) return { ok: false, error: input.error };

  const channel = await fetchYouTubeChannel('handle' in input ? { handle: input.handle } : { channelId: input.channelId });
  if (!channel.ok) {
    if (channel.reason === 'not-found') return { ok: false, error: `YouTube has no channel called ${raw.trim()}.` };
    return { ok: false, error: `YouTube did not answer: ${channel.detail}` };
  }

  const existing = await learn
    .from('catalogue_providers')
    .select(CHANNEL_COLUMNS)
    .eq('youtube_channel_id', channel.channelId)
    .maybeSingle();
  if (existing.error) throw new Error(`Looking for ${channel.title} failed: ${existing.error.message}`);
  if (existing.data) return { ok: true, channel: existing.data as ChannelRow, created: false };

  const fields = {
    youtube_channel_id: channel.channelId,
    youtube_handle: channel.handle,
    youtube_uploads_playlist_id: channel.uploadsPlaylistId,
    enabled: true,
  };

  const seeded = await learn
    .from('catalogue_providers')
    .select('id, slug, name')
    .is('youtube_channel_id', null);
  if (seeded.error) throw new Error(`Reading providers failed: ${seeded.error.message}`);
  const seededId = matchSeededProvider(channel, (seeded.data ?? []) as { id: string; slug: string; name: string }[]);

  if (seededId) {
    const updated = await learn
      .from('catalogue_providers')
      .update(fields)
      .eq('id', seededId)
      .select(CHANNEL_COLUMNS)
      .single();
    if (updated.error) throw new Error(`Storing ${channel.title} failed: ${updated.error.message}`);
    return { ok: true, channel: updated.data as ChannelRow, created: false };
  }

  let slug = slugForChannel(channel);
  const taken = await learn.from('catalogue_providers').select('id').eq('slug', slug).maybeSingle();
  if (taken.error) throw new Error(`Checking the slug ${slug} failed: ${taken.error.message}`);
  if (taken.data) slug = `${slug.slice(0, 57)}-yt`;

  const inserted = await learn
    .from('catalogue_providers')
    .insert({
      ...fields,
      slug,
      name: channel.title,
      home_url: channel.canonicalUrl,
      licence: 'Standard YouTube licence unless a video states otherwise',
      ingest_note:
        'Videos and playlists listed through the YouTube Data API; transcripts from TranscriptAPI when asked for.',
    })
    .select(CHANNEL_COLUMNS)
    .single();
  if (inserted.error) throw new Error(`Storing ${channel.title} failed: ${inserted.error.message}`);
  return { ok: true, channel: inserted.data as ChannelRow, created: true };
}

/** Every external id of one kind a provider has, paged past PostgREST's cap. */
async function storedExternalIds(
  learn: LearnSupabaseClient,
  providerId: string,
  kind: 'video' | 'course',
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let from = 0; ; from += PAGE_ROWS) {
    const page = await learn
      .from('catalogue_items')
      .select('id, external_id')
      .eq('provider_id', providerId)
      .eq('kind', kind)
      .order('external_id')
      .range(from, from + PAGE_ROWS - 1);
    if (page.error) throw new Error(`Reading stored ${kind}s failed: ${page.error.message}`);
    const rows = (page.data ?? []) as { id: string; external_id: string }[];
    for (const row of rows) ids.set(row.external_id, row.id);
    if (rows.length < PAGE_ROWS) return ids;
  }
}

function videoRow(providerId: string, video: YouTubeVideo) {
  const description = video.description.trim();
  return {
    provider_id: providerId,
    external_id: video.videoId,
    title: video.title.slice(0, 500) || video.videoId,
    kind: 'video' as const,
    canonical_url: video.canonicalUrl,
    published_at: video.publishedAt,
    duration_seconds: video.durationSeconds,
    length_chars: null,
    description: description ? description.slice(0, MAX_DESCRIPTION) : null,
  };
}

/** Upsert videos and return their item ids by video id. */
async function storeVideos(
  learn: LearnSupabaseClient,
  providerId: string,
  videos: YouTubeVideo[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let from = 0; from < videos.length; from += WRITE_BATCH) {
    const batch = videos.slice(from, from + WRITE_BATCH).map((video) => videoRow(providerId, video));
    const { data, error } = await learn
      .from('catalogue_items')
      .upsert(batch, { onConflict: 'provider_id,external_id' })
      .select('id, external_id');
    if (error) throw new Error(`Storing videos failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; external_id: string }[]) ids.set(row.external_id, row.id);
  }
  return ids;
}

export type ListChannelOptions = {
  /** Walk the channel's playlists too, whatever `youtube_listed_at` says. */
  playlists?: boolean;
  /** Epoch ms after which no further playlist is walked. */
  deadline?: number;
  now?: () => number;
};

export type ListChannelResult = {
  newVideos: number;
  /** New uploads queued because the channel transcribes automatically. */
  queued: number;
  playlistsWalked: number;
  playlistsSkipped: number;
  /** Playlists left for the next listing because the deadline passed. */
  playlistsNotReached: number;
  /** YouTube's refusal, when it refused; everything stored before it is kept. */
  error: string | null;
};

/**
 * List what a channel has published since it was last listed.
 *
 * Uploads first: newest first, stopping at the first video already stored, so
 * a re-list of a channel that posted twice this week reads one page. Then the
 * playlists, when asked for or when they are a week old. A playlist whose
 * stored length already matches YouTube's count is not walked again.
 */
export async function listChannel(
  learn: LearnSupabaseClient,
  channel: ChannelRow,
  options: ListChannelOptions = {},
): Promise<ListChannelResult> {
  const now = options.now ?? Date.now;
  const result: ListChannelResult = {
    newVideos: 0,
    queued: 0,
    playlistsWalked: 0,
    playlistsSkipped: 0,
    playlistsNotReached: 0,
    error: null,
  };

  const uploads = channel.youtube_uploads_playlist_id;
  if (!uploads) {
    result.error = 'this channel has no uploads playlist stored; remove it and add it again';
    return result;
  }

  const known = await storedExternalIds(learn, channel.id, 'video');
  const firstListing = channel.youtube_listed_at === null;

  const order = await fetchPlaylistVideoIds(uploads, {
    stopAt: firstListing ? undefined : new Set(known.keys()),
    maxPages: MAX_UPLOAD_PAGES,
  });
  if (!order.ok) {
    result.error = order.detail;
    return result;
  }

  const newIds = order.videoIds.filter((id) => !known.has(id));
  if (newIds.length > 0) {
    const details = await fetchVideosByIds(newIds);
    if (!details.ok) {
      result.error = details.detail;
      return result;
    }
    const stored = await storeVideos(learn, channel.id, details.videos);
    for (const [videoId, itemId] of stored) known.set(videoId, itemId);
    result.newVideos = stored.size;

    // Only uploads that appeared after the channel was first listed. The
    // first listing of a big channel would otherwise queue its whole
    // back catalogue.
    if (channel.auto_transcribe && !firstListing && stored.size > 0) {
      result.queued = await queueTranscripts(learn, [...stored.keys()], 'auto');
    }
  }

  const stale =
    channel.youtube_listed_at === null ||
    now() - new Date(channel.youtube_listed_at).getTime() > PLAYLIST_REFRESH_MS;

  if (options.playlists || stale) {
    const listed = await fetchChannelPlaylists(channel.youtube_channel_id);
    if (!listed.ok) {
      result.error = listed.detail;
    } else {
      const walked = await storePlaylists(learn, channel.id, listed.playlists, known, options.deadline, now);
      result.playlistsWalked = walked.walked;
      result.playlistsSkipped = walked.skipped;
      result.playlistsNotReached = walked.notReached;
      if (walked.error) result.error = walked.error;
    }
  }

  // Marked listed only once the playlists were reached, so a listing cut off
  // by the deadline walks them again next time. A first listing that stored
  // the uploads but not the playlists is marked listed at the epoch: that is
  // no longer a first listing, so the next one reads only new uploads, and it
  // is more than a week old, so the next one walks the playlists. Screens show
  // `last_swept_at`, which is always the real time.
  const update: Record<string, unknown> = { enabled: true, last_swept_at: new Date(now()).toISOString() };
  if (result.playlistsNotReached === 0 && !result.error) update.youtube_listed_at = new Date(now()).toISOString();
  else if (firstListing && result.newVideos > 0) update.youtube_listed_at = new Date(0).toISOString();
  const { error } = await learn.from('catalogue_providers').update(update).eq('id', channel.id);
  if (error) throw new Error(`Marking ${channel.name} listed failed: ${error.message}`);

  return result;
}

async function memberCount(learn: LearnSupabaseClient, courseItemId: string): Promise<number> {
  const { count, error } = await learn
    .from('catalogue_course_items')
    .select('id', { count: 'exact', head: true })
    .eq('course_item_id', courseItemId);
  if (error) throw new Error(`Counting a playlist failed: ${error.message}`);
  return count ?? 0;
}

async function storePlaylists(
  learn: LearnSupabaseClient,
  providerId: string,
  playlists: YouTubeChannelPlaylist[],
  videoItems: Map<string, string>,
  deadline: number | undefined,
  now: () => number,
): Promise<{ walked: number; skipped: number; notReached: number; error: string | null }> {
  const out = { walked: 0, skipped: 0, notReached: 0, error: null as string | null };
  if (playlists.length === 0) return out;

  const storedCourses = await storedExternalIds(learn, providerId, 'course');
  // New playlists first, so a listing that runs out of time has at least
  // found what it had never seen.
  const ordered = [...playlists].sort(
    (a, b) => Number(storedCourses.has(a.playlistId)) - Number(storedCourses.has(b.playlistId)),
  );

  for (const playlist of ordered) {
    if (deadline !== undefined && now() >= deadline) {
      out.notReached += 1;
      continue;
    }

    const head = await learn
      .from('catalogue_items')
      .upsert(
        {
          provider_id: providerId,
          external_id: playlist.playlistId,
          title: playlist.title.slice(0, 500) || playlist.playlistId,
          kind: 'course',
          canonical_url: playlistUrl(playlist.playlistId),
          published_at: null,
          duration_seconds: null,
          length_chars: null,
          description: playlist.description.trim().slice(0, MAX_DESCRIPTION) || null,
        },
        { onConflict: 'provider_id,external_id' },
      )
      .select('id')
      .single();
    if (head.error) throw new Error(`Storing the playlist ${playlist.title} failed: ${head.error.message}`);
    const courseItemId = (head.data as { id: string }).id;

    if (
      storedCourses.has(playlist.playlistId) &&
      playlist.itemCount !== null &&
      (await memberCount(learn, courseItemId)) === playlist.itemCount
    ) {
      out.skipped += 1;
      continue;
    }

    const order = await fetchPlaylistVideoIds(playlist.playlistId);
    if (!order.ok) {
      out.error = `${playlist.title}: ${order.detail}`;
      break;
    }

    // A playlist can hold videos from other channels. They are stored under
    // this channel too, since that is where this playlist found them.
    const missing = order.videoIds.filter((id) => !videoItems.has(id));
    if (missing.length > 0) {
      const details = await fetchVideosByIds(missing);
      if (!details.ok) {
        out.error = `${playlist.title}: ${details.detail}`;
        break;
      }
      for (const [videoId, itemId] of await storeVideos(learn, providerId, details.videos)) {
        videoItems.set(videoId, itemId);
      }
    }

    const members = order.videoIds
      .map((id) => videoItems.get(id))
      .filter((id): id is string => id !== undefined && id !== courseItemId);
    await replaceMembers(learn, courseItemId, members, order.videoIds, videoItems);
    out.walked += 1;
  }

  return out;
}

/** Delete and rewrite a playlist's order, as `storeCourse` does. */
async function replaceMembers(
  learn: LearnSupabaseClient,
  courseItemId: string,
  memberItemIds: string[],
  videoIds: string[],
  videoItems: Map<string, string>,
): Promise<void> {
  const removed = await learn.from('catalogue_course_items').delete().eq('course_item_id', courseItemId);
  if (removed.error) throw new Error(`Clearing a playlist's order failed: ${removed.error.message}`);

  const titles = new Map<string, string>();
  if (memberItemIds.length > 0) {
    for (let from = 0; from < memberItemIds.length; from += WRITE_BATCH) {
      const { data, error } = await learn
        .from('catalogue_items')
        .select('id, title')
        .in('id', memberItemIds.slice(from, from + WRITE_BATCH));
      if (error) throw new Error(`Reading a playlist's titles failed: ${error.message}`);
      for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
    }
  }

  const seen = new Set<string>();
  const rows: { course_item_id: string; member_item_id: string; position: number; provider_label: string | null }[] = [];
  for (const videoId of videoIds) {
    const memberId = videoItems.get(videoId);
    if (!memberId || memberId === courseItemId || seen.has(memberId)) continue;
    seen.add(memberId);
    rows.push({
      course_item_id: courseItemId,
      member_item_id: memberId,
      position: rows.length,
      provider_label: lectureLabel(titles.get(memberId) ?? ''),
    });
  }

  for (let from = 0; from < rows.length; from += WRITE_BATCH) {
    const { error } = await learn.from('catalogue_course_items').insert(rows.slice(from, from + WRITE_BATCH));
    if (error) throw new Error(`Writing a playlist's order failed: ${error.message}`);
  }
}

/** Every channel you follow. */
export async function loadChannels(learn: LearnSupabaseClient): Promise<ChannelRow[]> {
  const { data, error } = await learn
    .from('catalogue_providers')
    .select(CHANNEL_COLUMNS)
    .not('youtube_channel_id', 'is', null)
    .order('name');
  if (error) throw new Error(`Reading channels failed: ${error.message}`);
  return (data ?? []) as ChannelRow[];
}
