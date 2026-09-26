import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CardToWrite, WriteResult } from '@/lib/learn/feed/write-card';
import {
  planVideoCards,
  readStretches,
  stretchLabel,
  stretchText,
  WITHDRAWABLE,
  WITHDRAWN,
  type CardJob,
  type PileVideo,
  type StoredVideoCard,
  type TimedSegment,
} from './video-cards';

/**
 * Turning the card pile into Learn now cards, from the hourly feed top-up
 * (plan #1067). What to do is decided in video-cards.ts; this reads the rows,
 * claims each stretch as a picked card, and hands it to the top-up's own
 * writer (`writePickedCard`), which saves the idea as a concept and fills the
 * row in. A write that fails leaves the row picked, and the next run writes it.
 *
 * Runs with the service client, so every write names the person.
 */

const CONCURRENCY = 2;

export type VideoCardPassResult = {
  written: number;
  /** Stretches the writer turned down, kept as dropped so they are not paid for again. */
  dropped: number;
  /** Stretches with too little transcript to write from; tried again next run. */
  thin: number;
  failed: number;
  withdrawn: number;
  revived: number;
  stopped: string | null;
};

type ItemJoin = { title: string; author: string | null; provider: { name: string } | { name: string }[] | null };
type PileRow = { user_id: string; video_id: string; item_id: string; stretches: unknown; item: ItemJoin | ItemJoin[] | null };
type CardRow = {
  id: string;
  user_id: string;
  video_id: string;
  video_start_seconds: number;
  status: string;
  drop_reason: string | null;
  summary: string | null;
};

const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

async function readPile(learn: LearnSupabaseClient): Promise<PileVideo[]> {
  const { data, error } = await learn
    .from('watch_list')
    .select(
      'user_id, video_id, item_id, stretches, item:catalogue_items!watch_list_item_id_fkey(title, author, provider:catalogue_providers!catalogue_items_provider_id_fkey(name))',
    )
    .eq('verdict', 'card')
    .is('left_playlist_at', null);
  if (error) throw new Error(`Reading the card pile failed: ${error.message}`);
  return ((data ?? []) as unknown as PileRow[]).flatMap((row): PileVideo[] => {
    const item = one(row.item);
    if (!item) return [];
    return [
      {
        userId: row.user_id,
        videoId: row.video_id,
        itemId: row.item_id,
        title: item.title,
        channel: item.author ?? one(item.provider)?.name ?? null,
        stretches: readStretches(row.stretches),
      },
    ];
  });
}

async function readStored(learn: LearnSupabaseClient): Promise<StoredVideoCard[]> {
  const { data, error } = await learn
    .from('feed_cards')
    .select('id, user_id, video_id, video_start_seconds, status, drop_reason, summary')
    .eq('reason', 'video');
  if (error) throw new Error(`Reading the video cards failed: ${error.message}`);
  return ((data ?? []) as CardRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    startSeconds: row.video_start_seconds,
    status: row.status,
    dropReason: row.drop_reason,
    hasSummary: row.summary !== null,
  }));
}

async function readSegments(learn: LearnSupabaseClient, itemId: string): Promise<TimedSegment[]> {
  const { data, error } = await learn
    .from('catalogue_segments')
    .select('id, t_start_seconds, t_end_seconds, text')
    .eq('item_id', itemId)
    .order('ordinal');
  if (error) throw new Error(`Reading the video's transcript failed: ${error.message}`);
  return ((data ?? []) as { id: string; t_start_seconds: number | null; t_end_seconds: number | null; text: string }[]).map(
    (row) => ({ id: row.id, start: row.t_start_seconds, end: row.t_end_seconds, text: row.text }),
  );
}

/** Claim a stretch as a picked card, or null when another run holds it. */
async function claim(learn: LearnSupabaseClient, job: CardJob, segmentId: string): Promise<string | null> {
  const { video, stretch } = job;
  const { data, error } = await learn
    .from('feed_cards')
    .insert({
      user_id: video.userId,
      reason: 'video',
      item_id: video.itemId,
      segment_id: segmentId,
      idea_index: job.index,
      video_id: video.videoId,
      video_start_seconds: stretch.startSeconds,
      video_end_seconds: stretch.endSeconds,
      named_article: video.title,
      named_section: stretchLabel(stretch),
      pick_basis: stretch.point,
    })
    .select('id')
    .single();
  // Written by another run first: its card stands.
  if (error?.code === '23505') return null;
  if (error) throw new Error(`Claiming the stretch failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** Withdraw or bring back cards by id, only from the statuses the move allows. */
async function move(learn: LearnSupabaseClient, ids: string[], to: 'withdraw' | 'revive'): Promise<number> {
  if (ids.length === 0) return 0;
  const stamp = new Date().toISOString();
  const query =
    to === 'withdraw'
      ? learn
          .from('feed_cards')
          .update({ status: 'dropped', drop_reason: WITHDRAWN, updated_at: stamp })
          .in('id', ids)
          .in('status', [...WITHDRAWABLE])
      : learn
          .from('feed_cards')
          .update({ status: 'ready', drop_reason: null, updated_at: stamp })
          .in('id', ids)
          .eq('status', 'dropped')
          .eq('drop_reason', WITHDRAWN)
          .not('summary', 'is', null);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`Moving the video cards failed: ${error.message}`);
  return (data ?? []).length;
}

/**
 * One pass: set aside the cards whose video left the pile, bring back the
 * ones whose video returned, and write the stretches with no card yet until
 * the deadline.
 */
export async function writeVideoCards(
  learn: LearnSupabaseClient,
  options: {
    deadline: number;
    /** Writes one claimed card; the top-up's writePickedCard with spend recorded. */
    write: (userId: string, card: CardToWrite) => Promise<WriteResult>;
  },
): Promise<VideoCardPassResult> {
  const result: VideoCardPassResult = { written: 0, dropped: 0, thin: 0, failed: 0, withdrawn: 0, revived: 0, stopped: null };
  const plan = planVideoCards(await readPile(learn), await readStored(learn));
  result.withdrawn = await move(learn, plan.withdraw, 'withdraw');
  result.revived = await move(learn, plan.revive, 'revive');

  const segments = new Map<string, Promise<TimedSegment[]>>();
  const segmentsOf = (itemId: string) => {
    let read = segments.get(itemId);
    if (!read) segments.set(itemId, (read = readSegments(learn, itemId)));
    return read;
  };

  const one = async (job: CardJob) => {
    const material = stretchText(await segmentsOf(job.video.itemId), job.stretch);
    if (!material) {
      result.thin += 1;
      return;
    }
    const cardId = job.cardId ?? (await claim(learn, job, material.segmentId));
    if (!cardId) return;
    const card: CardToWrite = {
      id: cardId,
      segmentId: material.segmentId,
      reason: 'video',
      themeName: null,
      aimName: null,
      field: null,
      gap: null,
      article: job.video.title,
      section: stretchLabel(job.stretch),
      text: material.text,
      depth: null,
      video: { title: job.video.title, channel: job.video.channel, point: job.stretch.point },
      maxIdeas: 1,
    };
    const written = await options.write(job.video.userId, card);
    if (written.outcome === 'ready') result.written += 1;
    else if (written.outcome === 'dropped') result.dropped += 1;
    else {
      result.failed += 1;
      console.error(`[video cards] ${job.video.videoId} at ${job.stretch.startSeconds}s`, written.detail);
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < plan.write.length) {
      if (Date.now() >= options.deadline) {
        result.stopped = 'out of time; the next run carries on';
        return;
      }
      const job = plan.write[next++]!;
      await one(job).catch((error: unknown) => {
        result.failed += 1;
        console.error('[video cards]', error instanceof Error ? error.message : error);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.write.length) }, worker));
  return result;
}
