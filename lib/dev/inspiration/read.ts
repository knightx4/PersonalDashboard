import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { APP_VISION } from '@/lib/specs/vision';
import { loadInspirationTranscript } from './sync';
import { mergeNewTakeaways, supabaseMergeStore, type MergeOperation, type MergeStore } from './merge';
import { extractVideoTakeaways, type TakeawayCandidate, type Visions } from './takeaways';

/**
 * Reading the inspiration videos for takeaways and storing them (plan #1409,
 * under #1406).
 *
 * A video is read once: when its transcript is in and `processed_at` is null.
 * Reading it writes one `inspiration_takeaways` row per takeaway, each linked
 * to the video through `inspiration_takeaway_videos` with the video's own
 * wording, the quote and its moment, then sets `processed_at` and
 * `takeaway_count`. A video with nothing that applies is marked read with a
 * count of zero. A failed read leaves `processed_at` null and says why in
 * `process_error`, so the next run tries it again.
 *
 * Reading a video again never adds its takeaways twice. Before storing, the
 * open takeaways from an earlier read of the same video are cleared: one that
 * only this video makes is removed, and this video's link is taken off one
 * that other videos make too. A takeaway the person has acted on (crafted,
 * dismissed, or found covered) is left as it is. So a run that stopped between
 * storing and marking, or a deliberate re-read, ends in the same rows as one
 * clean read.
 *
 * Extract (lib/dev/inspiration/takeaways.ts) gives candidates, and
 * `saveVideoTakeaways` stores one row per candidate. Once the videos are read,
 * the merge pass (lib/dev/inspiration/merge.ts, #1410) folds each new row into
 * an earlier one that makes the same point and marks the ones a plan feature
 * or idea already covers. `covered` is that pass's judgement rather than the
 * person's, so a re-read clears it the same as `open` and the pass decides it
 * again.
 */

/** One video waiting to be read. `id` is the row's uuid, `videoId` YouTube's. */
export type UnreadVideo = {
  id: string;
  videoId: string;
  title: string;
  channel: string | null;
};

/** A takeaway an earlier read of this video linked to it. */
export type EarlierTakeaway = {
  takeawayId: string;
  status: string;
  /** How many videos the takeaway is linked to, this one included. */
  videoCount: number;
};

/**
 * What storing touches, narrowed so a test can hold it in memory. Every method
 * is for one person; `supabaseTakeawayStore` filters each query by them.
 */
export type TakeawayStore = {
  unreadVideos(userId: string): Promise<UnreadVideo[]>;
  visions(userId: string): Promise<Visions>;
  earlierTakeaways(userId: string, videoRowId: string): Promise<EarlierTakeaway[]>;
  deleteTakeaways(userId: string, takeawayIds: string[]): Promise<void>;
  unlink(userId: string, videoRowId: string, takeawayIds: string[]): Promise<void>;
  insertTakeaway(userId: string, videoRowId: string, takeaway: TakeawayCandidate): Promise<string>;
  markRead(userId: string, videoRowId: string, outcome: { count: number | null; error: string | null; at: string }): Promise<void>;
};

/** Statuses nobody chose: what a read stored and what the merge pass judged. */
const CLEARED_ON_REREAD = new Set(['open', 'covered']);

/**
 * Which of an earlier read's takeaways to clear before a video is stored
 * again: open or covered ones only this video makes are removed, and this
 * video's link comes off those other videos make too.
 */
export function clearBeforeRead(earlier: EarlierTakeaway[]): { remove: string[]; unlink: string[] } {
  const open = earlier.filter((row) => CLEARED_ON_REREAD.has(row.status));
  return {
    remove: open.filter((row) => row.videoCount <= 1).map((row) => row.takeawayId),
    unlink: open.filter((row) => row.videoCount > 1).map((row) => row.takeawayId),
  };
}

/**
 * Store one video's takeaways, replacing what an earlier read of it left open,
 * and mark the video read. Returns how many were stored.
 */
export async function saveVideoTakeaways(
  store: TakeawayStore,
  userId: string,
  videoRowId: string,
  takeaways: TakeawayCandidate[],
  now: Date,
): Promise<number> {
  const clear = clearBeforeRead(await store.earlierTakeaways(userId, videoRowId));
  if (clear.remove.length > 0) await store.deleteTakeaways(userId, clear.remove);
  if (clear.unlink.length > 0) await store.unlink(userId, videoRowId, clear.unlink);
  for (const takeaway of takeaways) await store.insertTakeaway(userId, videoRowId, takeaway);
  await store.markRead(userId, videoRowId, { count: takeaways.length, error: null, at: now.toISOString() });
  return takeaways.length;
}

/** What each spend report is recorded as in core.model_spend. */
export type InspirationOperation = 'read-inspiration-video' | MergeOperation;

export type InspirationReadOptions = {
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  /** Falls back to EMBEDDING_API_KEY; the merge pass waits for a run that has one. */
  embeddingApiKey?: string | null;
  /** Injected by the tests, so no test embeds over the network. */
  embed?: Parameters<typeof mergeNewTakeaways>[2]['embed'];
  /** Epoch ms after which no further video is started. */
  deadline?: number;
  /** Called once per model or embedding call, with the person it was for. */
  onSpend?: (userId: string, report: SpendReport, operation: InspirationOperation) => void;
  now?: () => Date;
};

export type InspirationRead = {
  userId: string;
  /** Videos read, with or without takeaways. */
  read: number;
  /** Takeaways stored across them, before merging. */
  takeaways: number;
  /** New takeaways folded into an earlier one that makes the same point. */
  merged: number;
  /** New takeaways a plan feature or idea already covers. */
  covered: number;
  /** Videos whose read failed; each says why in its row's process_error. */
  failed: number;
  /** Set when the run stopped before reading every video. */
  stopped: string | null;
};

/**
 * Read every unread video of one person's until the deadline, then merge what
 * was stored. The merge also takes up takeaways an earlier run stored but did
 * not get to, so it runs even when there is nothing new to read.
 */
export async function readInspirationVideos(
  store: TakeawayStore & MergeStore,
  loadCues: (videoId: string) => Promise<Awaited<ReturnType<typeof loadInspirationTranscript>>>,
  userId: string,
  options: InspirationReadOptions,
): Promise<InspirationRead> {
  const result = await readUnreadVideos(store, loadCues, userId, options);
  if (result.stopped) return result;
  const merge = await mergeNewTakeaways(store, userId, {
    anthropicApiKey: options.anthropicApiKey,
    client: options.client,
    embeddingApiKey: options.embeddingApiKey,
    embed: options.embed,
    deadline: options.deadline,
    onSpend: options.onSpend ? (report, operation) => options.onSpend!(userId, report, operation) : undefined,
  });
  return { ...result, merged: merge.merged, covered: merge.covered, stopped: merge.stopped };
}

async function readUnreadVideos(
  store: TakeawayStore,
  loadCues: (videoId: string) => Promise<Awaited<ReturnType<typeof loadInspirationTranscript>>>,
  userId: string,
  options: InspirationReadOptions,
): Promise<InspirationRead> {
  const now = options.now ?? (() => new Date());
  const result: InspirationRead = { userId, read: 0, takeaways: 0, merged: 0, covered: 0, failed: 0, stopped: null };
  const videos = await store.unreadVideos(userId);
  if (videos.length === 0) return result;
  const visions = await store.visions(userId);

  for (const video of videos) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      result.stopped = 'out of time; the next run carries on';
      break;
    }
    const transcript = await loadCues(video.videoId);
    const extracted = transcript
      ? await extractVideoTakeaways({
          video: { title: video.title, channel: video.channel, cues: transcript.cues },
          visions,
          anthropicApiKey: options.anthropicApiKey,
          client: options.client,
          onSpend: options.onSpend ? (report) => options.onSpend!(userId, report, 'read-inspiration-video') : undefined,
        })
      : ({ outcome: 'failed', detail: 'The transcript is not in the cache.' } as const);

    if (extracted.outcome === 'failed') {
      result.failed += 1;
      await store.markRead(userId, video.id, { count: null, error: extracted.detail.slice(0, 500), at: now().toISOString() });
      continue;
    }
    result.takeaways += await saveVideoTakeaways(store, userId, video.id, extracted.takeaways, now());
    result.read += 1;
  }
  return result;
}

/** The store over the service-role client, every query filtered by the person. */
export function supabaseTakeawayStore(learn: LearnSupabaseClient): TakeawayStore {
  const db = learn.schema('public');
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };

  return {
    async unreadVideos(userId) {
      const { data, error } = await db
        .from('inspiration_videos')
        .select('id, video_id, title, channel_title')
        .eq('user_id', userId)
        .eq('transcript_state', 'fetched')
        .is('left_playlist_at', null)
        .is('processed_at', null)
        .order('playlist_position', { ascending: true, nullsFirst: false });
      fail('Reading the unread inspiration videos', error);
      return ((data ?? []) as { id: string; video_id: string; title: string | null; channel_title: string | null }[]).map(
        (row) => ({ id: row.id, videoId: row.video_id, title: row.title ?? row.video_id, channel: row.channel_title }),
      );
    },

    async visions(userId) {
      const { data, error } = await db
        .from('module_visions')
        .select('module, body')
        .eq('user_id', userId)
        .in('module', [APP_VISION, 'dev']);
      fail('Reading the visions', error);
      const rows = (data ?? []) as { module: string; body: string }[];
      return {
        app: rows.find((row) => row.module === APP_VISION)?.body ?? null,
        dev: rows.find((row) => row.module === 'dev')?.body ?? null,
      };
    },

    async earlierTakeaways(userId, videoRowId) {
      const mine = await db
        .from('inspiration_takeaway_videos')
        .select('takeaway_id')
        .eq('user_id', userId)
        .eq('video_id', videoRowId);
      fail('Reading the video’s earlier takeaways', mine.error);
      const ids = ((mine.data ?? []) as { takeaway_id: string }[]).map((row) => row.takeaway_id);
      if (ids.length === 0) return [];
      const [takeaways, links] = await Promise.all([
        db.from('inspiration_takeaways').select('id, status').eq('user_id', userId).in('id', ids),
        db.from('inspiration_takeaway_videos').select('takeaway_id').eq('user_id', userId).in('takeaway_id', ids),
      ]);
      fail('Reading the earlier takeaways', takeaways.error);
      fail('Reading the earlier takeaways’ videos', links.error);
      const counts = new Map<string, number>();
      for (const row of (links.data ?? []) as { takeaway_id: string }[]) {
        counts.set(row.takeaway_id, (counts.get(row.takeaway_id) ?? 0) + 1);
      }
      return ((takeaways.data ?? []) as { id: string; status: string }[]).map((row) => ({
        takeawayId: row.id,
        status: row.status,
        videoCount: counts.get(row.id) ?? 0,
      }));
    },

    async deleteTakeaways(userId, takeawayIds) {
      const { error } = await db
        .from('inspiration_takeaways')
        .delete()
        .eq('user_id', userId)
        .in('status', [...CLEARED_ON_REREAD])
        .in('id', takeawayIds);
      fail('Clearing the earlier takeaways', error);
    },

    async unlink(userId, videoRowId, takeawayIds) {
      const { error } = await db
        .from('inspiration_takeaway_videos')
        .delete()
        .eq('user_id', userId)
        .eq('video_id', videoRowId)
        .in('takeaway_id', takeawayIds);
      fail('Unlinking the earlier takeaways', error);
    },

    async insertTakeaway(userId, videoRowId, takeaway) {
      const { data, error } = await db
        .from('inspiration_takeaways')
        .insert({ user_id: userId, title: takeaway.title, body: takeaway.body, module: takeaway.module })
        .select('id')
        .single();
      fail('Storing a takeaway', error);
      const id = (data as { id: string }).id;
      const link = await db.from('inspiration_takeaway_videos').insert({
        takeaway_id: id,
        video_id: videoRowId,
        user_id: userId,
        said: takeaway.body,
        quote: takeaway.quote || null,
        start_seconds: takeaway.startSeconds,
      });
      if (link.error) {
        // A takeaway with no video would never be found to clear, so it goes.
        await db.from('inspiration_takeaways').delete().eq('user_id', userId).eq('id', id);
        fail('Linking a takeaway to its video', link.error);
      }
      return id;
    },

    async markRead(userId, videoRowId, outcome) {
      const update =
        outcome.error === null
          ? { processed_at: outcome.at, takeaway_count: outcome.count, process_error: null }
          : { process_error: outcome.error };
      const { error } = await db.from('inspiration_videos').update(update).eq('user_id', userId).eq('id', videoRowId);
      fail('Marking the video read', error);
    },
  };
}

/**
 * Read the unread videos of everyone with an inspiration playlist, until the
 * deadline. The entry point for the daily run and Check now (#1411), after
 * `syncInspirationPlaylists` has fetched the transcripts.
 */
export async function readInspirationForEveryone(
  learn: LearnSupabaseClient,
  options: InspirationReadOptions,
): Promise<InspirationRead[]> {
  const { data, error } = await learn
    .schema('public')
    .from('inspiration_settings')
    .select('user_id')
    .not('youtube_playlist_id', 'is', null);
  if (error) throw new Error(`Reading the inspiration playlists failed: ${error.message}`);

  const store = { ...supabaseTakeawayStore(learn), ...supabaseMergeStore(learn) };
  const loadCues = (videoId: string) => loadInspirationTranscript(learn, videoId);
  const out: InspirationRead[] = [];
  for (const row of (data ?? []) as { user_id: string }[]) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    try {
      out.push(await readInspirationVideos(store, loadCues, row.user_id, options));
    } catch (failure) {
      out.push({
        userId: row.user_id,
        read: 0,
        takeaways: 0,
        merged: 0,
        covered: 0,
        failed: 0,
        stopped: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }
  return out;
}
