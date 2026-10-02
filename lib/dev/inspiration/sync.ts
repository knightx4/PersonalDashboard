import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fetchPlaylistVideoIds, fetchVideosByIds, type YouTubeVideo } from '@/lib/learn/providers/youtube';
import { MAX_PER_SCHEDULED_RUN } from '@/lib/learn/youtube/budget';
import {
  MAX_ATTEMPTS,
  loadCreditState,
  loadTranscript,
  queueTranscripts,
  transcribeVideos,
  type CallTrigger,
  type TranscribeResult,
  type TranscriptState,
} from '@/lib/learn/youtube/transcripts';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';

/**
 * The Inspiration tab's playlist sync (plan #1408, under #1406).
 *
 * Reads the playlist in `public.inspiration_settings` into
 * `public.inspiration_videos`, one row per video, and gets each video's
 * transcript. A video taken off the playlist is marked with
 * `left_playlist_at`, never deleted, so its takeaways stay; one that comes
 * back has the mark cleared.
 *
 * Transcripts go through Learn's cache (`learn.video_transcripts`, the
 * `learn-transcripts` bucket and the `learn.transcript_calls` ledger), so a
 * video on both the inspiration playlist and Learn's list is paid for once and
 * the month's credit meter counts these calls too. The words stay in that
 * cache; the row here mirrors only the state. A video already fetched costs
 * nothing, so a second run spends no credits.
 *
 * Listing costs YouTube Data API quota only: one unit per fifty videos for the
 * playlist and one per fifty new videos for their titles.
 */

/** 1,000 videos: the runaway guard, not a limit. */
const MAX_PLAYLIST_PAGES = 20;

export type InspirationVideoRow = {
  video_id: string;
  left_playlist_at: string | null;
  playlist_position: number | null;
};

export type InspirationPlan = {
  /** On the playlist and not stored yet, in playlist order. */
  add: string[];
  /** Stored, still marked on the playlist, and gone from it. */
  left: string[];
  /** Marked gone before, and back on the playlist. */
  back: string[];
  /** Stored videos whose place in the playlist changed. */
  moved: { videoId: string; position: number }[];
};

/**
 * What a run changes, from the playlist's ids and the rows already stored.
 * Nothing is marked gone when the listing stopped short, since a short listing
 * cannot say what is missing. Positions count from zero in playlist order.
 */
export function planInspirationSync(
  playlistIds: string[],
  stored: InspirationVideoRow[],
  complete: boolean,
): InspirationPlan {
  const onPlaylist = new Map(playlistIds.map((id, index) => [id, index]));
  const known = new Map(stored.map((row) => [row.video_id, row]));
  return {
    add: playlistIds.filter((id) => !known.has(id)),
    left: complete
      ? stored.filter((row) => row.left_playlist_at === null && !onPlaylist.has(row.video_id)).map((row) => row.video_id)
      : [],
    back: stored.filter((row) => row.left_playlist_at !== null && onPlaylist.has(row.video_id)).map((row) => row.video_id),
    moved: stored.flatMap((row) => {
      const position = onPlaylist.get(row.video_id);
      return position !== undefined && position !== row.playlist_position ? [{ videoId: row.video_id, position }] : [];
    }),
  };
}

/** A row of Learn's transcript cache, as far as the sync reads it. */
export type CacheRow = {
  video_id: string;
  state: TranscriptState;
  attempts: number;
  retry_after: string | null;
  last_error: string | null;
};

/**
 * Which videos to call TranscriptAPI for, and which are new to the cache.
 *
 * A video already fetched is not called for. One the cache found had no
 * captions, or that failed and is waiting out its back-off, is left until its
 * retry time; one that failed five times is left alone. Everything else,
 * including a video the cache has never seen, is called for.
 */
export function transcriptsToFetch(
  videoIds: string[],
  cache: CacheRow[],
  now: Date,
): { fetch: string[]; fresh: string[] } {
  const rows = new Map(cache.map((row) => [row.video_id, row]));
  const fetch: string[] = [];
  const fresh: string[] = [];
  for (const id of videoIds) {
    const row = rows.get(id);
    if (!row) {
      fresh.push(id);
      fetch.push(id);
      continue;
    }
    if (row.state === 'fetched') continue;
    if (row.attempts >= MAX_ATTEMPTS) continue;
    if (row.state !== 'queued' && row.retry_after !== null && Date.parse(row.retry_after) > now.getTime()) continue;
    fetch.push(id);
  }
  return { fetch, fresh };
}

/** The inspiration row's transcript fields, from the cache row. */
export function mirroredState(row: CacheRow | undefined): {
  transcript_state: TranscriptState;
  transcript_error: string | null;
} {
  if (!row) return { transcript_state: 'queued', transcript_error: null };
  return {
    transcript_state: row.state,
    transcript_error: row.state === 'fetched' ? null : row.last_error?.slice(0, 500) ?? null,
  };
}

/** The thumbnail YouTube serves for every video, without an API call. */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function videoInsert(userId: string, video: YouTubeVideo, position: number, addedAt: string) {
  return {
    user_id: userId,
    video_id: video.videoId,
    title: video.title.slice(0, 500),
    channel_title: video.channelTitle?.slice(0, 200) || null,
    channel_id: video.channelId ?? null,
    duration_seconds: video.durationSeconds,
    published_at: video.publishedAt,
    thumbnail_url: thumbnailUrl(video.videoId),
    playlist_position: position,
    added_at: addedAt,
  };
}

export type InspirationSyncOptions = {
  trigger?: CallTrigger;
  /** The most transcript credits this run may spend; the month's remainder caps it too. */
  maxCredits?: number;
  /** Epoch ms after which no further transcript call is started. */
  deadline?: number;
  now?: Date;
};

export type InspirationSync = {
  userId: string;
  playlistId: string | null;
  /** Videos on the playlist when it was read. */
  onPlaylist: number;
  added: number;
  left: number;
  back: number;
  /** On the playlist but private or deleted, so YouTube said nothing about it. */
  unavailable: number;
  /** Null when no transcript call was needed. */
  transcripts: TranscribeResult | null;
  /** Videos on the playlist whose transcript is in the cache. */
  withTranscript: number;
  error: string | null;
};

async function recordRead(learn: LearnSupabaseClient, userId: string, error: string | null, now: Date): Promise<void> {
  const update: Record<string, unknown> = { playlist_error: error };
  if (!error) update.playlist_read_at = now.toISOString();
  const result = await learn.schema('public').from('inspiration_settings').update(update).eq('user_id', userId);
  if (result.error) throw new Error(`Recording the inspiration playlist read failed: ${result.error.message}`);
}

async function readCache(learn: LearnSupabaseClient, videoIds: string[]): Promise<CacheRow[]> {
  if (videoIds.length === 0) return [];
  const { data, error } = await learn
    .from('video_transcripts')
    .select('video_id, state, attempts, retry_after, last_error')
    .in('video_id', videoIds);
  if (error) throw new Error(`Reading transcript states failed: ${error.message}`);
  return (data ?? []) as CacheRow[];
}

/**
 * Read one person's inspiration playlist and fetch the transcripts it needs.
 * Takes a service-role client bound to the learn schema; the inspiration
 * tables are reached through `.schema('public')` and every query filters by
 * `userId`.
 */
export async function syncInspiration(
  learn: LearnSupabaseClient,
  userId: string,
  options: InspirationSyncOptions = {},
): Promise<InspirationSync> {
  const now = options.now ?? new Date();
  const db = learn.schema('public');
  const result: InspirationSync = {
    userId,
    playlistId: null,
    onPlaylist: 0,
    added: 0,
    left: 0,
    back: 0,
    unavailable: 0,
    transcripts: null,
    withTranscript: 0,
    error: null,
  };

  const settings = await db
    .from('inspiration_settings')
    .select('youtube_playlist_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (settings.error) throw new Error(`Reading the inspiration playlist failed: ${settings.error.message}`);
  const playlistId = (settings.data as { youtube_playlist_id: string | null } | null)?.youtube_playlist_id ?? null;
  result.playlistId = playlistId;
  if (!playlistId) {
    result.error = 'No inspiration playlist is set.';
    return result;
  }

  const order = await fetchPlaylistVideoIds(playlistId, { maxPages: MAX_PLAYLIST_PAGES, withAddedAt: true });
  if (!order.ok) {
    result.error =
      order.reason === 'not-found'
        ? 'YouTube has no playlist with that link, or it is private. Make it unlisted or public.'
        : order.detail;
    await recordRead(learn, userId, result.error, now);
    return result;
  }
  result.onPlaylist = order.videoIds.length;

  const stored = await db
    .from('inspiration_videos')
    .select('video_id, left_playlist_at, playlist_position')
    .eq('user_id', userId);
  if (stored.error) throw new Error(`Reading the inspiration videos failed: ${stored.error.message}`);
  const plan = planInspirationSync(order.videoIds, (stored.data ?? []) as InspirationVideoRow[], order.complete);

  if (plan.add.length > 0) {
    const details = await fetchVideosByIds(plan.add);
    if (!details.ok) {
      result.error = details.detail;
      await recordRead(learn, userId, result.error, now);
      return result;
    }
    const byId = new Map(details.videos.map((video) => [video.videoId, video]));
    // A private or deleted video has no title to show, so it waits: the next
    // run asks again, and adds it if it has come back.
    const rows = plan.add.flatMap((id) => {
      const video = byId.get(id);
      return video
        ? [videoInsert(userId, video, order.videoIds.indexOf(id), order.addedAt[id] ?? now.toISOString())]
        : [];
    });
    result.unavailable = plan.add.length - rows.length;
    if (rows.length > 0) {
      const { error } = await db
        .from('inspiration_videos')
        .upsert(rows, { onConflict: 'user_id,video_id', ignoreDuplicates: true });
      if (error) throw new Error(`Adding inspiration videos failed: ${error.message}`);
    }
    result.added = rows.length;
  }

  for (const [ids, value] of [
    [plan.left, now.toISOString()],
    [plan.back, null],
  ] as const) {
    if (ids.length === 0) continue;
    const { error } = await db
      .from('inspiration_videos')
      .update({ left_playlist_at: value })
      .eq('user_id', userId)
      .in('video_id', ids);
    if (error) throw new Error(`Marking inspiration videos failed: ${error.message}`);
  }
  result.left = plan.left.length;
  result.back = plan.back.length;

  for (const move of plan.moved) {
    const { error } = await db
      .from('inspiration_videos')
      .update({ playlist_position: move.position })
      .eq('user_id', userId)
      .eq('video_id', move.videoId);
    if (error) throw new Error(`Reordering inspiration videos failed: ${error.message}`);
  }

  await recordRead(learn, userId, null, now);

  // Transcripts, for every video on the playlist whose row is not fetched yet.
  const current = await db
    .from('inspiration_videos')
    .select('video_id, transcript_state, transcript_error')
    .eq('user_id', userId)
    .is('left_playlist_at', null);
  if (current.error) throw new Error(`Reading the inspiration videos failed: ${current.error.message}`);
  const videos = (current.data ?? []) as {
    video_id: string;
    transcript_state: TranscriptState;
    transcript_error: string | null;
  }[];
  const waiting = videos.filter((video) => video.transcript_state !== 'fetched').map((video) => video.video_id);
  result.withTranscript = videos.length - waiting.length;
  if (waiting.length === 0) return result;

  const { fetch, fresh } = transcriptsToFetch(waiting, await readCache(learn, waiting), now);
  if (fresh.length > 0) await queueTranscripts(learn, fresh, 'inspiration');
  if (fetch.length > 0) {
    const credits = await loadCreditState(learn, now);
    result.transcripts = await transcribeVideos(learn, fetch, {
      trigger: options.trigger ?? 'press',
      maxCredits: Math.min(credits.remaining, options.maxCredits ?? MAX_PER_SCHEDULED_RUN),
      deadline: options.deadline,
    });
  }

  const cache = new Map((await readCache(learn, waiting)).map((row) => [row.video_id, row]));
  for (const video of videos) {
    if (video.transcript_state === 'fetched') continue;
    const next = mirroredState(cache.get(video.video_id));
    if (next.transcript_state === 'fetched') result.withTranscript += 1;
    if (next.transcript_state === video.transcript_state && next.transcript_error === video.transcript_error) continue;
    const { error } = await db
      .from('inspiration_videos')
      .update(next)
      .eq('user_id', userId)
      .eq('video_id', video.video_id);
    if (error) throw new Error(`Recording ${video.video_id}'s transcript state failed: ${error.message}`);
  }

  return result;
}

/** Every person with an inspiration playlist set, until the deadline. */
export async function syncInspirationPlaylists(
  learn: LearnSupabaseClient,
  options: InspirationSyncOptions = {},
): Promise<InspirationSync[]> {
  const { data, error } = await learn
    .schema('public')
    .from('inspiration_settings')
    .select('user_id')
    .not('youtube_playlist_id', 'is', null);
  if (error) throw new Error(`Reading the inspiration playlists failed: ${error.message}`);

  const out: InspirationSync[] = [];
  for (const row of (data ?? []) as { user_id: string }[]) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    try {
      out.push(await syncInspiration(learn, row.user_id, options));
    } catch (failure) {
      out.push({
        userId: row.user_id,
        playlistId: null,
        onPlaylist: 0,
        added: 0,
        left: 0,
        back: 0,
        unavailable: 0,
        transcripts: null,
        withTranscript: 0,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }
  return out;
}

/**
 * A video's transcript from the cache, or null when it has none yet. The
 * inspiration row's `transcript_state` says whether to expect one.
 */
export async function loadInspirationTranscript(
  learn: LearnSupabaseClient,
  videoId: string,
): Promise<{ language: string | null; cues: TranscriptCue[] } | null> {
  return loadTranscript(learn, videoId);
}
