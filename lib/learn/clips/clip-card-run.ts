import 'server-only';

import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CardToWrite, WriteResult } from '@/lib/learn/feed/write-card';
import { stretchLabel } from '@/lib/learn/youtube/video-cards';
import {
  clipPoint,
  clipText,
  freeIdeaIndex,
  homeSegment,
  planClipCards,
  type ClipCardJob,
  type SavedClip,
  type SegmentSpan,
  type StoredClipCard,
} from './clip-cards';

/**
 * Writing a Learn now card for each saved clip, from the hourly feed top-up
 * (plan #1405). Saving a clip is the queue: this reads the saved clips with
 * no card, claims each as a picked video card carrying the clip's id, and
 * hands it to the top-up's writer (`writePickedCard`), as the card-pile pass
 * (lib/learn/youtube/video-card-run.ts) does for a stretch. A write that
 * fails leaves the row picked, and the next run writes it.
 *
 * Un-saving a clip before the run means no card is written; a card already
 * written stays in Learn now, where it can be skipped like any other.
 *
 * Runs with the service client, so every read and write names the person.
 */

export type ClipCardPassResult = {
  written: number;
  /** Clips the writer turned down; kept as dropped so they are not paid for again. */
  dropped: number;
  /** Clips with too few transcript words, or no catalogue segment, to write from. */
  thin: number;
  failed: number;
  stopped: string | null;
};

type ClipRow = {
  id: string;
  user_id: string;
  video_id: string;
  item_id: string | null;
  start_seconds: number;
  end_seconds: number;
  caption: string;
  idea: string | null;
};
type CardRow = {
  id: string;
  user_id: string;
  video_id: string;
  video_start_seconds: number;
  clip_id: string | null;
  status: string;
};
type ItemRow = {
  id: string;
  title: string;
  author: string | null;
  provider: { name: string } | { name: string }[] | null;
};

const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

async function readSaved(learn: LearnSupabaseClient): Promise<SavedClip[]> {
  const { data, error } = await learn
    .from('video_clips')
    .select('id, user_id, video_id, item_id, start_seconds, end_seconds, caption, idea')
    .not('saved_at', 'is', null)
    .is('not_interested_at', null)
    .order('saved_at');
  if (error) throw new Error(`Reading the saved clips failed: ${error.message}`);
  return ((data ?? []) as ClipRow[]).flatMap((row): SavedClip[] =>
    row.item_id
      ? [
          {
            id: row.id,
            userId: row.user_id,
            videoId: row.video_id,
            itemId: row.item_id,
            startSeconds: row.start_seconds,
            endSeconds: row.end_seconds,
            caption: row.caption,
            idea: row.idea,
          },
        ]
      : [],
  );
}

async function readStored(learn: LearnSupabaseClient, userIds: string[]): Promise<StoredClipCard[]> {
  const { data, error } = await learn
    .from('feed_cards')
    .select('id, user_id, video_id, video_start_seconds, clip_id, status')
    .eq('reason', 'video')
    .in('user_id', userIds);
  if (error) throw new Error(`Reading the video cards failed: ${error.message}`);
  return ((data ?? []) as CardRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    startSeconds: row.video_start_seconds,
    clipId: row.clip_id,
    status: row.status,
  }));
}

async function readItem(learn: LearnSupabaseClient, itemId: string): Promise<{ title: string; channel: string | null } | null> {
  const { data, error } = await learn
    .from('catalogue_items')
    .select('id, title, author, provider:catalogue_providers!catalogue_items_provider_id_fkey(name)')
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw new Error(`Reading the clip's video failed: ${error.message}`);
  const row = data as unknown as ItemRow | null;
  if (!row) return null;
  return { title: row.title, channel: row.author ?? one(row.provider)?.name ?? null };
}

async function readSegments(learn: LearnSupabaseClient, itemId: string): Promise<SegmentSpan[]> {
  const { data, error } = await learn
    .from('catalogue_segments')
    .select('id, t_start_seconds, t_end_seconds')
    .eq('item_id', itemId)
    .order('ordinal');
  if (error) throw new Error(`Reading the video's segments failed: ${error.message}`);
  return ((data ?? []) as { id: string; t_start_seconds: number | null; t_end_seconds: number | null }[]).map((row) => ({
    id: row.id,
    start: row.t_start_seconds,
    end: row.t_end_seconds,
  }));
}

/** Claim the clip as a picked card, or null when another run holds it or the segment has no index free. */
async function claim(
  learn: LearnSupabaseClient,
  clip: SavedClip,
  segmentId: string,
  title: string,
): Promise<string | null> {
  const { data: usedRows, error: usedError } = await learn
    .from('feed_cards')
    .select('idea_index')
    .eq('user_id', clip.userId)
    .eq('segment_id', segmentId);
  if (usedError) throw new Error(`Reading the segment's cards failed: ${usedError.message}`);
  const index = freeIdeaIndex(new Set(((usedRows ?? []) as { idea_index: number }[]).map((row) => row.idea_index)));
  if (index === null) return null;
  const { data, error } = await learn
    .from('feed_cards')
    .insert({
      user_id: clip.userId,
      reason: 'video',
      item_id: clip.itemId,
      segment_id: segmentId,
      idea_index: index,
      video_id: clip.videoId,
      video_start_seconds: clip.startSeconds,
      video_end_seconds: clip.endSeconds,
      clip_id: clip.id,
      named_article: title,
      named_section: stretchLabel(clip),
      pick_basis: clipPoint(clip),
    })
    .select('id')
    .single();
  // Claimed by another run first, or a card already opens at this second: it stands.
  if (error?.code === '23505') return null;
  if (error) throw new Error(`Claiming the clip failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** One pass: write a card for every saved clip with none, until the deadline. */
export async function writeClipCards(
  learn: LearnSupabaseClient,
  options: {
    deadline: number;
    /** Writes one claimed card; the top-up's writePickedCard with spend recorded. */
    write: (userId: string, card: CardToWrite) => Promise<WriteResult>;
    /** The video's stored timed transcript; loadTranscript in the run. */
    transcript: (videoId: string) => Promise<{ cues: TranscriptCue[] } | null>;
  },
): Promise<ClipCardPassResult> {
  const result: ClipCardPassResult = { written: 0, dropped: 0, thin: 0, failed: 0, stopped: null };
  const saved = await readSaved(learn);
  if (saved.length === 0) return result;
  const jobs = planClipCards(saved, await readStored(learn, [...new Set(saved.map((clip) => clip.userId))]));

  const oneJob = async ({ clip, cardId: claimed }: ClipCardJob) => {
    const [item, segments, transcript] = await Promise.all([
      readItem(learn, clip.itemId),
      readSegments(learn, clip.itemId),
      options.transcript(clip.videoId),
    ]);
    const text = transcript ? clipText(transcript.cues, clip) : null;
    const segmentId = homeSegment(segments, clip.startSeconds);
    if (!item || !text || !segmentId) {
      result.thin += 1;
      return;
    }
    const cardId = claimed ?? (await claim(learn, clip, segmentId, item.title));
    if (!cardId) return;
    const card: CardToWrite = {
      id: cardId,
      segmentId,
      reason: 'video',
      themeName: null,
      aimName: null,
      field: null,
      gap: null,
      article: item.title,
      section: stretchLabel(clip),
      text,
      depth: null,
      video: { title: item.title, channel: item.channel, point: clipPoint(clip) },
      maxIdeas: 1,
    };
    const written = await options.write(clip.userId, card);
    if (written.outcome === 'ready') result.written += 1;
    else if (written.outcome === 'dropped') result.dropped += 1;
    else {
      result.failed += 1;
      console.error(`[clip cards] ${clip.videoId} at ${clip.startSeconds}s`, written.detail);
    }
  };

  // One at a time: a person saves a few clips an hour, not dozens.
  for (const job of jobs) {
    if (Date.now() >= options.deadline) {
      result.stopped = 'out of time; the next run carries on';
      break;
    }
    await oneJob(job).catch((error: unknown) => {
      result.failed += 1;
      console.error('[clip cards]', error instanceof Error ? error.message : error);
    });
  }
  return result;
}
