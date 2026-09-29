import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fetchPlaylistVideoIds, fetchVideosByIds, type YouTubeVideo } from '@/lib/learn/providers/youtube';
import { videoRow } from './library';

/**
 * Your list: the videos you chose to watch, read from a playlist you keep
 * (plan #1065).
 *
 * YouTube's API answers an empty list for Watch later to every app, so you
 * save videos to a playlist of your own and paste its link into Learn. It is
 * kept in `learn.settings.youtube_playlist_id`, and every library run reads the
 * playlist into `learn.watch_list`, one row per video.
 *
 * Each row points at a catalogue row of kind video (`item_id`), which is where
 * the transcript and embedding code reach a video. A video already in the
 * catalogue, from a channel Learn follows, is linked as it is. A new one is
 * stored under its channel's provider when Learn follows the channel, and
 * under `youtube-list` with the channel's name as the author when it does not.
 *
 * Listing costs Data API quota only: one unit per fifty videos for the
 * playlist and one per fifty new videos for their titles. No transcript is
 * asked for here; the judge (#1066) queues them for the videos that pass.
 */

/** The provider that holds list videos from channels Learn does not follow. */
export const LIST_PROVIDER_SLUG = 'youtube-list';

/** 5,000 videos, the same guard as a channel's uploads. */
const MAX_PLAYLIST_PAGES = 100;

const BATCH = 200;

export type WatchListRow = {
  video_id: string;
  item_id: string | null;
  left_playlist_at: string | null;
};

export type WatchListPlan = {
  /** On the playlist and not yet on the list, in playlist order. */
  add: string[];
  /** On the list from the playlist, and gone from it. */
  left: string[];
  /** Marked gone before, and back on the playlist. */
  back: string[];
};

/**
 * What a run changes, from the playlist's ids and the rows already stored.
 *
 * A video gone from the playlist is marked, never deleted, so its verdict and
 * summary survive being tidied out of the playlist. Nothing is marked gone
 * when the listing stopped short, since a short listing cannot say what is
 * missing.
 */
export function planWatchList(playlistIds: string[], stored: WatchListRow[], complete: boolean): WatchListPlan {
  const onPlaylist = new Set(playlistIds);
  const known = new Map(stored.map((row) => [row.video_id, row]));
  return {
    add: playlistIds.filter((id) => !known.has(id)),
    left: complete
      ? stored.filter((row) => row.left_playlist_at === null && !onPlaylist.has(row.video_id)).map((row) => row.video_id)
      : [],
    back: stored.filter((row) => row.left_playlist_at !== null && onPlaylist.has(row.video_id)).map((row) => row.video_id),
  };
}

export type WatchListSync = {
  userId: string;
  added: number;
  left: number;
  /** On the playlist but private or deleted, so YouTube said nothing about it. */
  unavailable: number;
  error: string | null;
};

type SettingsRow = { user_id: string; youtube_playlist_id: string };

/** Every playlist somebody has pasted, one per person. */
async function playlistsToRead(learn: LearnSupabaseClient): Promise<SettingsRow[]> {
  const { data, error } = await learn
    .from('settings')
    .select('user_id, youtube_playlist_id')
    .not('youtube_playlist_id', 'is', null);
  if (error) throw new Error(`Reading the playlists to list failed: ${error.message}`);
  return (data ?? []) as SettingsRow[];
}

/** The catalogue rows of kind video these ids already have, one per id. */
export async function catalogueItems(learn: LearnSupabaseClient, videoIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let from = 0; from < videoIds.length; from += BATCH) {
    const { data, error } = await learn
      .from('catalogue_items')
      .select('id, external_id')
      .eq('kind', 'video')
      .in('external_id', videoIds.slice(from, from + BATCH))
      .order('created_at');
    if (error) throw new Error(`Looking for videos in the catalogue failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; external_id: string }[]) {
      if (!found.has(row.external_id)) found.set(row.external_id, row.id);
    }
  }
  return found;
}

/** Providers by YouTube channel id, and the list's own provider. */
async function providers(learn: LearnSupabaseClient): Promise<{ byChannel: Map<string, string>; list: string }> {
  const { data, error } = await learn
    .from('catalogue_providers')
    .select('id, slug, youtube_channel_id')
    .or(`slug.eq.${LIST_PROVIDER_SLUG},youtube_channel_id.not.is.null`);
  if (error) throw new Error(`Reading providers failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; slug: string; youtube_channel_id: string | null }[];
  const list = rows.find((row) => row.slug === LIST_PROVIDER_SLUG)?.id;
  if (!list) throw new Error(`The ${LIST_PROVIDER_SLUG} provider is missing; learn migration 0065 adds it.`);
  const byChannel = new Map<string, string>();
  for (const row of rows) if (row.youtube_channel_id) byChannel.set(row.youtube_channel_id, row.id);
  return { byChannel, list };
}

/** Store videos the catalogue does not have, and return their item ids. */
export async function storeNewVideos(learn: LearnSupabaseClient, videos: YouTubeVideo[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (videos.length === 0) return ids;
  const { byChannel, list } = await providers(learn);
  const rows = videos.map((video) => {
    const followed = video.channelId ? byChannel.get(video.channelId) : undefined;
    // A followed channel is the provider, so its name is not repeated as the author.
    return { ...videoRow(followed ?? list, video), author: followed ? null : video.channelTitle?.slice(0, 200) || null };
  });

  for (let from = 0; from < rows.length; from += BATCH) {
    const { data, error } = await learn
      .from('catalogue_items')
      .upsert(rows.slice(from, from + BATCH), { onConflict: 'provider_id,external_id' })
      .select('id, external_id');
    if (error) throw new Error(`Storing your list's videos failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; external_id: string }[]) ids.set(row.external_id, row.id);
  }
  return ids;
}

async function recordRead(
  learn: LearnSupabaseClient,
  userId: string,
  error: string | null,
  now: Date,
): Promise<void> {
  const update: Record<string, unknown> = { youtube_playlist_error: error, updated_at: now.toISOString() };
  if (!error) update.youtube_playlist_read_at = now.toISOString();
  const result = await learn.from('settings').update(update).eq('user_id', userId);
  if (result.error) throw new Error(`Recording the playlist read failed: ${result.error.message}`);
}

/** Read one person's playlist into their list. */
export async function syncWatchList(
  learn: LearnSupabaseClient,
  userId: string,
  playlistId: string,
  now: Date = new Date(),
): Promise<WatchListSync> {
  const result: WatchListSync = { userId, added: 0, left: 0, unavailable: 0, error: null };

  const order = await fetchPlaylistVideoIds(playlistId, { maxPages: MAX_PLAYLIST_PAGES, withAddedAt: true });
  if (!order.ok) {
    result.error =
      order.reason === 'not-found'
        ? 'YouTube has no playlist with that link, or it is private. Make it unlisted or public.'
        : order.detail;
    await recordRead(learn, userId, result.error, now);
    return result;
  }

  const stored = await learn
    .from('watch_list')
    .select('video_id, item_id, left_playlist_at')
    .eq('user_id', userId)
    .eq('came_from', 'playlist');
  if (stored.error) throw new Error(`Reading your list failed: ${stored.error.message}`);
  const plan = planWatchList(order.videoIds, (stored.data ?? []) as WatchListRow[], order.complete);

  if (plan.add.length > 0) {
    const items = await catalogueItems(learn, plan.add);
    const missing = plan.add.filter((id) => !items.has(id));
    if (missing.length > 0) {
      const details = await fetchVideosByIds(missing);
      if (!details.ok) {
        result.error = details.detail;
        await recordRead(learn, userId, result.error, now);
        return result;
      }
      for (const [videoId, itemId] of await storeNewVideos(learn, details.videos)) items.set(videoId, itemId);
    }

    // A private or deleted video has no title to show, so it waits: the next
    // run asks again, and adds it if it has come back.
    const rows = plan.add
      .filter((id) => items.has(id))
      .map((id) => ({
        user_id: userId,
        video_id: id,
        item_id: items.get(id) ?? null,
        came_from: 'playlist',
        added_at: order.addedAt[id] ?? now.toISOString(),
      }));
    result.unavailable = plan.add.length - rows.length;
    for (let from = 0; from < rows.length; from += BATCH) {
      const { error } = await learn
        .from('watch_list')
        .upsert(rows.slice(from, from + BATCH), { onConflict: 'user_id,video_id', ignoreDuplicates: true });
      if (error) throw new Error(`Adding to your list failed: ${error.message}`);
    }
    result.added = rows.length;
  }

  for (const [ids, value] of [
    [plan.left, now.toISOString()],
    [plan.back, null],
  ] as const) {
    for (let from = 0; from < ids.length; from += BATCH) {
      const { error } = await learn
        .from('watch_list')
        .update({ left_playlist_at: value, updated_at: now.toISOString() })
        .eq('user_id', userId)
        .in('video_id', ids.slice(from, from + BATCH));
      if (error) throw new Error(`Updating your list failed: ${error.message}`);
    }
  }
  result.left = plan.left.length;

  await recordRead(learn, userId, null, now);
  return result;
}

/** The library run's part: every pasted playlist, until the deadline. */
export async function syncWatchLists(
  learn: LearnSupabaseClient,
  options: { deadline?: number } = {},
): Promise<WatchListSync[]> {
  const out: WatchListSync[] = [];
  for (const row of await playlistsToRead(learn)) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    try {
      out.push(await syncWatchList(learn, row.user_id, row.youtube_playlist_id));
    } catch (error) {
      out.push({
        userId: row.user_id,
        added: 0,
        left: 0,
        unavailable: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

export type WatchListSettings = {
  playlistId: string | null;
  readAt: string | null;
  error: string | null;
  /** Videos on the list and still on the playlist. */
  videos: number;
};

/** What the settings show: the playlist, when it was read, and the count. */
export async function loadWatchListSettings(learn: LearnSupabaseClient, userId: string): Promise<WatchListSettings> {
  const [settings, count] = await Promise.all([
    learn
      .from('settings')
      .select('youtube_playlist_id, youtube_playlist_read_at, youtube_playlist_error')
      .eq('user_id', userId)
      .maybeSingle(),
    learn
      .from('watch_list')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('left_playlist_at', null),
  ]);
  if (settings.error) throw new Error(`Reading your Learn settings failed: ${settings.error.message}`);
  if (count.error) throw new Error(`Counting your list failed: ${count.error.message}`);
  const row = settings.data as {
    youtube_playlist_id: string | null;
    youtube_playlist_read_at: string | null;
    youtube_playlist_error: string | null;
  } | null;
  return {
    playlistId: row?.youtube_playlist_id ?? null,
    readAt: row?.youtube_playlist_read_at ?? null,
    error: row?.youtube_playlist_error ?? null,
    videos: count.count ?? 0,
  };
}

/** Keep the playlist in Learn settings, or forget it with null. */
export async function saveWatchListPlaylist(
  learn: LearnSupabaseClient,
  userId: string,
  playlistId: string | null,
): Promise<void> {
  const { error } = await learn.from('settings').upsert(
    {
      user_id: userId,
      youtube_playlist_id: playlistId,
      youtube_playlist_read_at: null,
      youtube_playlist_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`Saving the playlist failed: ${error.message}`);
}
