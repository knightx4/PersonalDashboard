import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { cutVideo, sentencesFromCues, type Clip } from './clips';
import type { LearnerProfile } from './judge-video';
import { loadLearnerProfile } from './judging';
import { loadTranscript } from './transcripts';

/**
 * Cutting clips from the library run (plan #1398).
 *
 * Which videos: only those whose transcript is already stored (state
 * 'fetched'), so cutting never spends a transcript credit. Two lists: the
 * person's own playlist (learn.watch_list, newest added first) and videos
 * from the channels Learn follows (catalogue providers with a YouTube channel,
 * newest published first), cut for the app's owner, since the catalogue
 * belongs to nobody (#1396). They are taken in turn, one from each, so the
 * channels are cut alongside the playlist rather than only once it is
 * finished. A video already in learn.video_clip_cuts for that person is not
 * sent again; a video on both lists is cut once, as playlist.
 *
 * Each video is one Haiku call (clips.ts). Its clips are upserted on (person,
 * video, start second), each tagged in video_clip_subjects with every track it
 * serves, and a row goes in video_clip_cuts even when it gave none. A call that failed or ran out of time writes nothing, so the next run
 * tries it again; a reply that could not be read is recorded with its error
 * and not sent again.
 *
 * Runs with the service client, so every read and write names the person.
 */

/** Videos cut per scheduled run. */
export const CLIPS_PER_RUN = 12;
/**
 * No video is cut for a person who already has this many clips waiting to be
 * shown. Unshown means what the stream (clips/next.ts) still offers as new:
 * shown_at and not_interested_at both null. 261 clips were cut in two days and
 * 253 never shown, so cutting waits until the stream works through them.
 */
export const UNSHOWN_CAP = 40;
const CONCURRENCY = 4;
const BATCH = 200;
const PAGE = 1000;

export type CameFrom = 'playlist' | 'channel';

export type VideoToClip = {
  userId: string;
  videoId: string;
  itemId: string | null;
  cameFrom: CameFrom;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
};

export type ClipPassResult = {
  /** Videos cut, including those that gave no clips. */
  cut: number;
  clips: number;
  /** Calls that failed and will be tried again. */
  failed: number;
  /** Replies that could not be read, recorded so they are not sent again. */
  unreadable: number;
  /** Videos with a stored transcript still waiting to be cut after this run. */
  waiting: number;
  /** Videos held back because their person already has UNSHOWN_CAP clips unshown. */
  held: number;
  stopped: string | null;
};

type ItemRow = {
  id: string;
  title: string;
  author: string | null;
  duration_seconds: number | null;
  published_at?: string | null;
  provider_id?: string;
  external_id?: string;
};

async function fetchedVideoIds(learn: LearnSupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await learn
      .from('video_transcripts')
      .select('video_id')
      .eq('state', 'fetched')
      .order('video_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the stored transcripts failed: ${error.message}`);
    const rows = (data ?? []) as { video_id: string }[];
    for (const row of rows) out.add(row.video_id);
    if (rows.length < PAGE) return out;
  }
}

async function cutAlready(learn: LearnSupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await learn
      .from('video_clip_cuts')
      .select('user_id, video_id')
      .order('video_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the videos already cut failed: ${error.message}`);
    const rows = (data ?? []) as { user_id: string; video_id: string }[];
    for (const row of rows) out.add(`${row.user_id}:${row.video_id}`);
    if (rows.length < PAGE) return out;
  }
}

async function playlistVideos(learn: LearnSupabaseClient, fetched: Set<string>): Promise<VideoToClip[]> {
  const { data, error } = await learn
    .from('watch_list')
    .select('user_id, video_id, item_id, item:catalogue_items!watch_list_item_id_fkey(id, title, author, duration_seconds)')
    .is('left_playlist_at', null)
    .order('added_at', { ascending: false });
  if (error) throw new Error(`Reading your list to cut failed: ${error.message}`);
  type Row = { user_id: string; video_id: string; item_id: string | null; item: ItemRow | ItemRow[] | null };
  return ((data ?? []) as unknown as Row[]).flatMap((row): VideoToClip[] => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    if (!fetched.has(row.video_id) || !item) return [];
    return [
      {
        userId: row.user_id,
        videoId: row.video_id,
        itemId: row.item_id ?? item.id,
        cameFrom: 'playlist',
        title: item.title,
        channel: item.author,
        durationSeconds: item.duration_seconds,
      },
    ];
  });
}

async function channelVideos(learn: LearnSupabaseClient, owner: string, fetched: Set<string>): Promise<VideoToClip[]> {
  const providers = await learn.from('catalogue_providers').select('id, name').not('youtube_channel_id', 'is', null);
  if (providers.error) throw new Error(`Reading the followed channels failed: ${providers.error.message}`);
  const names = new Map(((providers.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  if (names.size === 0) return [];
  const ids = [...fetched];
  const items: ItemRow[] = [];
  for (let from = 0; from < ids.length; from += BATCH) {
    const { data, error } = await learn
      .from('catalogue_items')
      .select('id, title, author, duration_seconds, published_at, provider_id, external_id')
      .eq('kind', 'video')
      .in('external_id', ids.slice(from, from + BATCH))
      .in('provider_id', [...names.keys()]);
    if (error) throw new Error(`Reading the channel videos failed: ${error.message}`);
    items.push(...((data ?? []) as ItemRow[]));
  }
  items.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return items.map((item) => ({
    userId: owner,
    videoId: item.external_id!,
    itemId: item.id,
    cameFrom: 'channel',
    title: item.title,
    channel: item.author ?? names.get(item.provider_id!) ?? null,
    durationSeconds: item.duration_seconds,
  }));
}

/** Two lists taken in turn, one from each, until both run out. */
export function alternate<T>(first: readonly T[], second: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (i < first.length) out.push(first[i]);
    if (i < second.length) out.push(second[i]);
  }
  return out;
}

/**
 * Every video waiting to be cut, in the order they are cut: a playlist video,
 * then a channel video, and so on. Each person and video once.
 */
export async function videosToClip(learn: LearnSupabaseClient, owner: string | null): Promise<VideoToClip[]> {
  const fetched = await fetchedVideoIds(learn);
  if (fetched.size === 0) return [];
  const done = await cutAlready(learn);
  const playlist = await playlistVideos(learn, fetched);
  const onPlaylist = new Set(playlist.map((video) => `${video.userId}:${video.videoId}`));
  const fresh = (video: VideoToClip) => !done.has(`${video.userId}:${video.videoId}`);
  const channels = (owner ? await channelVideos(learn, owner, fetched) : []).filter(
    (video) => !onPlaylist.has(`${video.userId}:${video.videoId}`),
  );
  const seen = new Set<string>();
  return alternate(playlist.filter(fresh), channels.filter(fresh)).filter((video) => {
    const id = `${video.userId}:${video.videoId}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * One learn.video_clip_subjects row for every track each stored clip serves
 * (plan #1695). The stored rows come back from the upsert with their ids, and
 * are matched to the clips by the second they start at, which is unique per
 * person and video.
 */
export function clipSubjectRows(
  userId: string,
  stored: readonly { id: string; start_seconds: number }[],
  clips: readonly Pick<Clip, 'startSeconds' | 'subjectIds'>[],
): { user_id: string; clip_id: string; subject_id: string }[] {
  const idAt = new Map(stored.map((row) => [row.start_seconds, row.id]));
  const rows: { user_id: string; clip_id: string; subject_id: string }[] = [];
  for (const clip of clips) {
    const clipId = idAt.get(clip.startSeconds);
    if (!clipId) continue;
    for (const subjectId of new Set(clip.subjectIds)) rows.push({ user_id: userId, clip_id: clipId, subject_id: subjectId });
  }
  return rows;
}

async function storeClips(learn: LearnSupabaseClient, video: VideoToClip, clips: Clip[], stamp: string): Promise<void> {
  if (clips.length > 0) {
    const { data, error } = await learn.from('video_clips').upsert(
      clips.map((clip) => ({
        user_id: video.userId,
        video_id: video.videoId,
        item_id: video.itemId,
        came_from: video.cameFrom,
        start_seconds: clip.startSeconds,
        end_seconds: clip.endSeconds,
        caption: clip.caption,
        idea: clip.idea,
        serves: clip.serves,
        subject_id: clip.subjectId,
        goal_id: clip.goalId,
        cut_at: stamp,
      })),
      { onConflict: 'user_id,video_id,start_seconds' },
    ).select('id, start_seconds');
    if (error) throw new Error(`Storing the clips failed: ${error.message}`);
    // A re-cut adds tags and never removes one.
    const tags = clipSubjectRows(video.userId, (data ?? []) as { id: string; start_seconds: number }[], clips);
    if (tags.length > 0) {
      const { error: tagError } = await learn
        .from('video_clip_subjects')
        .upsert(tags, { onConflict: 'clip_id,subject_id', ignoreDuplicates: true });
      if (tagError) throw new Error(`Tagging the clips with their subjects failed: ${tagError.message}`);
    }
  }
  await recordCut(learn, video, clips.length, null, stamp);
}

async function recordCut(
  learn: LearnSupabaseClient,
  video: VideoToClip,
  clipCount: number,
  problem: string | null,
  stamp: string,
): Promise<void> {
  const { error } = await learn.from('video_clip_cuts').upsert(
    {
      user_id: video.userId,
      video_id: video.videoId,
      item_id: video.itemId,
      came_from: video.cameFrom,
      clip_count: clipCount,
      error: problem ? problem.slice(0, 2000) : null,
      cut_at: stamp,
    },
    { onConflict: 'user_id,video_id' },
  );
  if (error) throw new Error(`Recording the cut failed: ${error.message}`);
}

/**
 * The people among `userIds` who already have `cap` or more clips not yet
 * shown. Reads at most `cap` ids per person.
 */
export async function peopleWithEnoughUnshown(learn: LearnSupabaseClient, userIds: string[], cap: number): Promise<Set<string>> {
  const full = new Set<string>();
  for (const userId of userIds) {
    const { data, error } = await learn
      .from('video_clips')
      .select('id')
      .eq('user_id', userId)
      .is('shown_at', null)
      .is('not_interested_at', null)
      .limit(cap);
    if (error) throw new Error(`Counting the clips not yet shown failed: ${error.message}`);
    if ((data ?? []).length >= cap) full.add(userId);
  }
  return full;
}

/**
 * Cut the next videos waiting, until the cap or the time runs out. A person
 * with UNSHOWN_CAP clips not yet shown gets no new cuts this run.
 */
export async function cutClips(
  learn: LearnSupabaseClient,
  options: {
    anthropicApiKey: string;
    /** No new video is started after this. */
    deadline: number;
    /** A call still running at this point is abandoned, and the video is tried again next run. */
    hardDeadline?: number;
    /** The app's owner, who the channel videos are cut for. Without one, only playlists are cut. */
    owner: string | null;
    limit?: number;
    client?: Anthropic;
    /** Called once per call made, with the person the clips are for. */
    onSpend?: (userId: string, report: SpendReport) => void;
    now?: () => Date;
    /** Stands in for loadLearnerProfile, for tests. */
    profileFor?: (userId: string) => Promise<LearnerProfile>;
    /** Clips not yet shown at which a person's cutting pauses. Defaults to UNSHOWN_CAP. */
    unshownCap?: number;
  },
): Promise<ClipPassResult> {
  const result: ClipPassResult = { cut: 0, clips: 0, failed: 0, unreadable: 0, waiting: 0, held: 0, stopped: null };
  const now = options.now ?? (() => new Date());
  const waiting = await videosToClip(learn, options.owner);
  const full = await peopleWithEnoughUnshown(
    learn,
    [...new Set(waiting.map((video) => video.userId))],
    options.unshownCap ?? UNSHOWN_CAP,
  );
  const eligible = waiting.filter((video) => !full.has(video.userId));
  result.held = waiting.length - eligible.length;
  const queue = eligible.slice(0, options.limit ?? CLIPS_PER_RUN);
  const profiles = new Map<string, Promise<LearnerProfile>>();
  const profileOf = (userId: string) => {
    let profile = profiles.get(userId);
    if (!profile) {
      profile = options.profileFor ? options.profileFor(userId) : loadLearnerProfile(learn, userId);
      profiles.set(userId, profile);
    }
    return profile;
  };

  const one = async (video: VideoToClip) => {
    const stamp = () => now().toISOString();
    const stored = await loadTranscript(learn, video.videoId);
    if (!stored || stored.cues.length === 0) {
      await recordCut(learn, video, 0, 'The stored transcript could not be read.', stamp());
      result.unreadable += 1;
      return;
    }
    const cut = await cutVideo({
      profile: await profileOf(video.userId),
      video: {
        title: video.title,
        channel: video.channel,
        durationSeconds: video.durationSeconds,
        sentences: sentencesFromCues(stored.cues),
      },
      anthropicApiKey: options.anthropicApiKey,
      client: options.client,
      onSpend: options.onSpend ? (report) => options.onSpend!(video.userId, report) : undefined,
      timeoutMs: options.hardDeadline !== undefined ? options.hardDeadline - Date.now() : undefined,
    });
    if (cut.outcome === 'failed') {
      result.failed += 1;
      console.error(`[clips] ${video.videoId}`, cut.detail);
      return;
    }
    if (cut.outcome === 'unreadable') {
      await recordCut(learn, video, 0, cut.detail, stamp());
      result.unreadable += 1;
      return;
    }
    await storeClips(learn, video, cut.clips, stamp());
    result.cut += 1;
    result.clips += cut.clips.length;
  };

  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (Date.now() >= options.deadline) {
        result.stopped = 'out of time; the next run carries on';
        return;
      }
      const video = queue[next++];
      try {
        await one(video);
      } catch (error) {
        result.failed += 1;
        console.error(`[clips] ${video.videoId}`, error instanceof Error ? error.message : error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  result.waiting = waiting.length - result.cut - result.unreadable;
  return result;
}
