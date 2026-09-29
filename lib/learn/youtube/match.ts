import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts } from '@/lib/learn/embed/embed';
import { metadataText } from './metadata-text';
import { queueTranscripts } from './transcripts';

/**
 * Choosing which listed videos to transcribe (learn migration 0059).
 *
 * Twelve channels list about 22,000 videos and the plan pays for 1,000
 * transcripts a month, so the scheduled run spends them on the videos nearest
 * the owner's own ideas. Two steps, both in the run: embed the title and
 * description of every listed video that has no vector yet, then keep a short
 * queue of the best untranscribed matches. The run's existing monthly pacing
 * (budget.ts) decides how many of the queue are fetched each time.
 */

/** Videos read per embedding call. */
const EMBED_BATCH = 128;

/**
 * Vectors written per call to store_video_metadata_embeddings. Each row
 * written also goes into the HNSW index on metadata_embedding, which cost
 * about 71ms a row on 29 September 2026 with 8,704 vectors in it, so a whole
 * batch of 128 took about 9 seconds and PostgREST's 8-second statement
 * timeout cancelled it in every run on 28 September (plan #1171). Thirty-two
 * rows is about 2.3 seconds, which leaves room for the index to grow.
 */
export const STORE_CHUNK = 32;

/**
 * How close a video's title and description has to be to one of your ideas
 * to be worth a credit. Set at 0.45 before any video had a vector, then raised
 * after the first run on 26 September 2026: of the 28 picks between 0.45 and
 * 0.50 about two thirds were unrelated (Hooke's law for a muscle protein, plate
 * tectonics for settlement mounds, mythology outtakes for a founder story),
 * against about one in eight above 0.50. Raised again on 27 September, with
 * 4,736 of 23,845 videos embedded: of the 17 candidates between 0.50 and 0.53
 * about half were unrelated (eyewitness memory for jury nullification, a
 * coupon-collector puzzle for consumer choice, election basics for housing
 * overhangs), against about one in five above 0.53.
 */
export const MATCH_MIN_SIMILARITY = 0.53;

/** Nearest videos kept per idea before the transcribed ones are dropped. */
export const MATCH_PER_CONCEPT = 3;

/**
 * The most transcripts left waiting at once. About two days of the scheduled
 * run's share at 1,000 credits a month, so the queue follows the ideas the
 * feed is writing now rather than the ones it wrote a fortnight ago.
 */
export const MATCH_QUEUE_TARGET = 60;

/**
 * The shortest time the scheduled run gives the title and description pass,
 * counted from when the pass starts (plan #1147). It used to stop at a fixed
 * 135 seconds into the run, so when channel listing ran to its own 115-second
 * deadline the pass had about 20 seconds: two or three batches, against 16 to
 * 19 when listing finished early. A batch takes about four seconds, so 60
 * seconds is about fifteen batches, near 1,900 videos.
 */
export const METADATA_SLICE_MS = 60_000;

/**
 * When the scheduled run's title and description pass stops: a fixed point in
 * the run (`earliestEnd`, counted from `started`) when listing leaves room,
 * and never less than `METADATA_SLICE_MS` after the pass begins at `now`,
 * however long listing took.
 */
export function metadataEmbedDeadline(started: number, earliestEnd: number, now: number): number {
  return Math.max(started + earliestEnd, now + METADATA_SLICE_MS);
}

export type MetadataEmbedResult = {
  embedded: number;
  /** Why the pass stopped before the videos ran out, when it did. */
  stopped: string | null;
};

/**
 * Embed titles and descriptions until the videos or the time run out.
 *
 * A batch that fails to embed or to store stops the pass, with the reason in
 * `stopped`, and is picked up by the next run: what was not written is still
 * unembedded. Stopping rather than throwing keeps the match queue running.
 */
export async function embedVideoMetadata(
  learn: LearnSupabaseClient,
  options: { deadline: number; onSpend?: SpendSink },
): Promise<MetadataEmbedResult> {
  const result: MetadataEmbedResult = { embedded: 0, stopped: null };
  if (!process.env.EMBEDDING_API_KEY?.trim()) return { ...result, stopped: 'no EMBEDDING_API_KEY' };

  while (Date.now() < options.deadline) {
    const { data, error } = await learn
      .from('catalogue_items')
      .select('id, title, description')
      .eq('kind', 'video')
      .is('metadata_embedding', null)
      .order('id')
      .limit(EMBED_BATCH);
    if (error) throw new Error(`Reading unembedded videos failed: ${error.message}`);
    const rows = (data ?? []) as { id: string; title: string; description: string | null }[];
    if (rows.length === 0) return result;

    const embedded = await embedTexts({
      texts: rows.map((row) => metadataText(row.title, row.description)),
      inputType: 'document',
      onSpend: options.onSpend,
    });
    if (!embedded.ok) return { ...result, stopped: `${embedded.reason}: ${embedded.detail}` };

    for (let at = 0; at < rows.length; at += STORE_CHUNK) {
      const stored = await learn.rpc('store_video_metadata_embeddings', {
        item_ids: rows.slice(at, at + STORE_CHUNK).map((row) => row.id),
        vectors: embedded.vectors.slice(at, at + STORE_CHUNK).map(vectorLiteral),
        model: embedded.model,
      });
      if (stored.error) return { ...result, stopped: `storing video vectors: ${stored.error.message}` };
      result.embedded += Number(stored.data ?? 0);
    }
  }

  return { ...result, stopped: 'time' };
}

export type MatchQueueResult = {
  /** Transcripts already waiting when the run looked. */
  waiting: number;
  /** Matches added to the queue this run. */
  queued: number;
  /** What was queued, with the idea it was queued for, for the run's report. */
  picks: { videoId: string; title: string; idea: string; similarity: number }[];
};

/**
 * Top the transcript queue up to `MATCH_QUEUE_TARGET` with the best matches
 * for the owner's ideas that nothing has asked for yet.
 */
export async function queueMatchingVideos(
  learn: LearnSupabaseClient,
  ownerId: string,
): Promise<MatchQueueResult> {
  const { count, error } = await learn
    .from('video_transcripts')
    .select('video_id', { count: 'exact', head: true })
    .eq('state', 'queued');
  if (error) throw new Error(`Counting the transcript queue failed: ${error.message}`);
  const waiting = count ?? 0;
  const room = MATCH_QUEUE_TARGET - waiting;
  if (room <= 0) return { waiting, queued: 0, picks: [] };

  const matches = await learn.rpc('videos_to_transcribe', {
    owner_id: ownerId,
    per_concept: MATCH_PER_CONCEPT,
    min_similarity: MATCH_MIN_SIMILARITY,
    match_limit: room,
  });
  if (matches.error) throw new Error(`Matching videos to your ideas failed: ${matches.error.message}`);
  const rows = (matches.data ?? []) as {
    video_id: string;
    item_title: string;
    concept_name: string;
    similarity: number;
  }[];
  if (rows.length === 0) return { waiting, queued: 0, picks: [] };

  const queued = await queueTranscripts(
    learn,
    rows.map((row) => row.video_id),
    'match',
  );
  return {
    waiting,
    queued,
    picks: rows.map((row) => ({
      videoId: row.video_id,
      title: row.item_title,
      idea: row.concept_name,
      similarity: Math.round(row.similarity * 1000) / 1000,
    })),
  };
}
