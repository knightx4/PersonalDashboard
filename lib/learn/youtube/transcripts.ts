import 'server-only';

import { gunzipSync, gzipSync } from 'node:zlib';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { writeSegmentsOverRest } from '@/lib/learn/catalogue/store-rest';
import { segmentsForVideo, type TranscriptCue } from '@/lib/learn/catalogue/segment';
import { chaptersFromDescription } from '@/lib/learn/providers/youtube';
import { fetchTranscript, isVideoId, type TranscriptResult } from '@/lib/learn/providers/transcriptapi';
import { creditState, monthStart, monthlyAllowance, type CreditState } from './budget';

/**
 * Getting a video's transcript once, and never paying for it twice.
 *
 * The order for each video: look in `learn.video_transcripts`, and stop there
 * if the transcript is already fetched. Otherwise check the month's credits,
 * call TranscriptAPI, write the call to `learn.transcript_calls` whatever it
 * answered, put the words in the `learn-transcripts` bucket, record the state,
 * and cut the transcript into `catalogue_segments` for every catalogue item
 * that is this video. The segments are left unembedded; the embedding pass
 * picks them up.
 *
 * A run stops early on 402 (no credits), 401 (bad key), on reaching its credit
 * allowance, and at its deadline. Everything before the stop is kept.
 */

export const TRANSCRIPT_BUCKET = 'learn-transcripts';

/** A video that failed this many times is left alone until pressed again. */
const MAX_ATTEMPTS = 5;

/** A video with no captions is looked at again after this long. */
const NO_CAPTIONS_RETRY_MS = 30 * 86_400_000;

export type TranscriptState = 'queued' | 'fetched' | 'none' | 'failed';
export type RequestedBy = 'press' | 'auto' | 'course' | 'match';
export type CallTrigger = 'press' | 'scheduled';

export function storagePathFor(videoId: string): string {
  return `youtube/${videoId}.json.gz`;
}

type StoredFile = {
  v: 1;
  videoId: string;
  language: string | null;
  fetchedAt: string;
  /** `[start, end, text]`, seconds. Arrays rather than objects: half the bytes. */
  cues: [number, number | null, string][];
};

export function encodeTranscript(
  videoId: string,
  language: string | null,
  cues: TranscriptCue[],
  fetchedAt: Date,
): Buffer {
  const file: StoredFile = {
    v: 1,
    videoId,
    language,
    fetchedAt: fetchedAt.toISOString(),
    cues: cues.map((cue) => [
      Math.round(cue.startSeconds * 100) / 100,
      cue.endSeconds === null ? null : Math.round(cue.endSeconds * 100) / 100,
      cue.text,
    ]),
  };
  return gzipSync(JSON.stringify(file));
}

export function decodeTranscript(bytes: Uint8Array): { language: string | null; cues: TranscriptCue[] } {
  const file = JSON.parse(gunzipSync(bytes).toString('utf8')) as StoredFile;
  return {
    language: file.language,
    cues: file.cues.map(([startSeconds, endSeconds, text]) => ({ startSeconds, endSeconds, text })),
  };
}

/** What the row becomes after a call that did not return usable words. */
export type StateUpdate = {
  state: TranscriptState;
  attempts: number;
  last_error: string | null;
  retry_after: string | null;
};

/**
 * The row after a failed call, and whether the run should stop.
 *
 * 404 is an answer, not a failure: the video has no captions. It is looked at
 * again in a month, because captions are sometimes added after upload. 402
 * and 401 are about the account rather than the video, so the video stays
 * queued and the run stops. Anything temporary is tried again next run, up to
 * five times.
 */
export function afterFailure(
  result: Extract<TranscriptResult, { ok: false }>,
  attempts: number,
  now: Date,
): { update: StateUpdate; stopRun: boolean } {
  if (result.outcome === 'no-transcript') {
    return {
      update: {
        state: 'none',
        attempts,
        last_error: result.detail,
        retry_after: new Date(now.getTime() + NO_CAPTIONS_RETRY_MS).toISOString(),
      },
      stopRun: false,
    };
  }

  if (result.outcome === 'out-of-credits' || result.outcome === 'unauthorized') {
    return {
      update: { state: 'queued', attempts, last_error: result.detail, retry_after: null },
      stopRun: true,
    };
  }

  const next = attempts + 1;
  // An hour, then four, then a day.
  const waitMs = next <= 1 ? 3_600_000 : next <= 2 ? 4 * 3_600_000 : 86_400_000;
  return {
    update: {
      state: 'failed',
      attempts: next,
      last_error: result.detail,
      retry_after: result.retryable ? new Date(now.getTime() + waitMs).toISOString() : null,
    },
    // A rate limit on one video will be a rate limit on the next.
    stopRun: result.outcome === 'rate-limited',
  };
}

/** Credits this app spent since the start of the month. */
export async function creditsUsedThisMonth(learn: LearnSupabaseClient, now: Date): Promise<number> {
  const { count, error } = await learn
    .from('transcript_calls')
    .select('id', { count: 'exact', head: true })
    .eq('credits', 1)
    .gte('called_at', monthStart(now).toISOString());
  if (error) throw new Error(`Reading the transcript ledger failed: ${error.message}`);
  return count ?? 0;
}

export async function loadCreditState(learn: LearnSupabaseClient, now: Date = new Date()): Promise<CreditState> {
  return creditState(await creditsUsedThisMonth(learn, now), monthlyAllowance(), now);
}

/**
 * Ask for transcripts. A video already fetched is left as it is; one that
 * failed or had no captions is asked for again, because a press is somebody
 * saying they want it. Returns how many rows are now waiting.
 */
export async function queueTranscripts(
  learn: LearnSupabaseClient,
  videoIds: string[],
  requestedBy: RequestedBy,
): Promise<number> {
  const wanted = [...new Set(videoIds.filter(isVideoId))];
  if (wanted.length === 0) return 0;

  let queued = 0;
  for (let from = 0; from < wanted.length; from += 200) {
    const batch = wanted.slice(from, from + 200);
    const existing = await learn.from('video_transcripts').select('video_id, state').in('video_id', batch);
    if (existing.error) throw new Error(`Reading transcript states failed: ${existing.error.message}`);
    const states = new Map(
      ((existing.data ?? []) as { video_id: string; state: TranscriptState }[]).map((row) => [row.video_id, row.state]),
    );

    const fresh = batch.filter((id) => !states.has(id));
    const retry = batch.filter((id) => {
      const state = states.get(id);
      return state === 'failed' || (state === 'none' && requestedBy === 'press');
    });

    if (fresh.length > 0) {
      const { error } = await learn
        .from('video_transcripts')
        .insert(fresh.map((video_id) => ({ video_id, state: 'queued', requested_by: requestedBy })));
      if (error) throw new Error(`Queuing transcripts failed: ${error.message}`);
    }
    if (retry.length > 0) {
      const { error } = await learn
        .from('video_transcripts')
        .update({ state: 'queued', attempts: 0, retry_after: null, last_error: null, requested_at: new Date().toISOString() })
        .in('video_id', retry);
      if (error) throw new Error(`Re-queuing transcripts failed: ${error.message}`);
    }
    queued += fresh.length + retry.length + batch.filter((id) => states.get(id) === 'queued').length;
  }
  return queued;
}

/** What is waiting for the scheduled run, oldest first. */
export async function waitingVideoIds(learn: LearnSupabaseClient, limit: number, now: Date): Promise<string[]> {
  if (limit <= 0) return [];
  const { data, error } = await learn
    .from('video_transcripts')
    .select('video_id')
    .in('state', ['queued', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .or(`retry_after.is.null,retry_after.lte.${now.toISOString()}`)
    .order('requested_at')
    .limit(limit);
  if (error) throw new Error(`Reading the transcript queue failed: ${error.message}`);
  return ((data ?? []) as { video_id: string }[]).map((row) => row.video_id);
}

type ItemForCut = { id: string; title: string; description: string | null; duration_seconds: number | null };

async function itemsForVideo(learn: LearnSupabaseClient, videoId: string): Promise<ItemForCut[]> {
  const { data, error } = await learn
    .from('catalogue_items')
    .select('id, title, description, duration_seconds')
    .eq('kind', 'video')
    .eq('external_id', videoId);
  if (error) throw new Error(`Reading ${videoId}'s catalogue rows failed: ${error.message}`);
  return (data ?? []) as ItemForCut[];
}

/** Cut the transcript, or the fallback, into each catalogue row for the video. */
async function writeSegmentsFor(
  learn: LearnSupabaseClient,
  videoId: string,
  cues: TranscriptCue[] | null,
): Promise<number> {
  let written = 0;
  for (const item of await itemsForVideo(learn, videoId)) {
    if (cues === null) {
      // No captions: give the video its chapter or whole-video cut, but only
      // if it has nothing, so a transcript cut is never replaced by a worse one.
      const { count, error } = await learn
        .from('catalogue_segments')
        .select('id', { count: 'exact', head: true })
        .eq('item_id', item.id);
      if (error) throw new Error(`Counting ${item.title}'s segments failed: ${error.message}`);
      if ((count ?? 0) > 0) continue;
    }
    const description = item.description ?? '';
    const { segments } = segmentsForVideo(
      {
        title: item.title,
        description,
        durationSeconds: item.duration_seconds,
        chapters: chaptersFromDescription(description),
      },
      cues,
    );
    await writeSegmentsOverRest(learn, item.id, segments, item.title);
    written += segments.length;
  }
  return written;
}

async function recordCall(
  learn: LearnSupabaseClient,
  videoId: string,
  result: TranscriptResult,
  trigger: CallTrigger,
): Promise<void> {
  const row: { video_id: string; status: number; credits: number; outcome: string; trigger: CallTrigger; detail: string | null } = result.ok
    ? { video_id: videoId, status: 200, credits: 1, outcome: 'fetched', trigger, detail: null }
    : {
        video_id: videoId,
        status: result.status,
        credits: result.credits,
        outcome: result.outcome,
        trigger,
        detail: result.detail.slice(0, 500),
      };
  const { error } = await learn.from('transcript_calls').insert(row);
  // The one write that must not be lost quietly: a credit spent and not
  // counted makes the meter wrong. Logged loudly; the run carries on, because
  // the transcript it paid for is still worth keeping.
  if (error) console.error(`[learn.transcript_calls] ${videoId}: ${error.message}`);
}

export type TranscribeOptions = {
  trigger: CallTrigger;
  /** The most credits this run may spend. */
  maxCredits: number;
  /** Epoch ms after which no further call is started. */
  deadline?: number;
  now?: () => number;
};

export type TranscribeResult = {
  fetched: number;
  /** Videos found to have no captions. */
  none: number;
  failed: number;
  /** Already fetched, so nothing was spent. */
  cached: number;
  credits: number;
  segments: number;
  /** Why the run ended before the list did, or null. */
  stopped: { reason: 'budget' | 'time' | 'account' | 'rate-limited'; detail: string } | null;
};

/**
 * Fetch transcripts for these videos, in order, within the allowance.
 */
export async function transcribeVideos(
  learn: LearnSupabaseClient,
  videoIds: string[],
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const now = options.now ?? Date.now;
  const result: TranscribeResult = {
    fetched: 0,
    none: 0,
    failed: 0,
    cached: 0,
    credits: 0,
    segments: 0,
    stopped: null,
  };

  const wanted = [...new Set(videoIds.filter(isVideoId))];
  if (wanted.length === 0) return result;

  const existing = await learn
    .from('video_transcripts')
    .select('video_id, state, attempts, retry_after')
    .in('video_id', wanted);
  if (existing.error) throw new Error(`Reading transcript states failed: ${existing.error.message}`);
  const rows = new Map(
    ((existing.data ?? []) as { video_id: string; state: TranscriptState; attempts: number }[]).map((row) => [
      row.video_id,
      row,
    ]),
  );

  for (const videoId of wanted) {
    const row = rows.get(videoId);
    if (row?.state === 'fetched') {
      result.cached += 1;
      continue;
    }

    if (result.credits >= options.maxCredits) {
      result.stopped = { reason: 'budget', detail: 'this month’s TranscriptAPI allowance is spent' };
      break;
    }
    if (options.deadline !== undefined && now() >= options.deadline) {
      result.stopped = { reason: 'time', detail: 'ran out of time; the rest stay queued' };
      break;
    }

    if (!row) {
      const { error } = await learn
        .from('video_transcripts')
        .upsert({ video_id: videoId, state: 'queued', requested_by: 'press' }, { onConflict: 'video_id', ignoreDuplicates: true });
      if (error) throw new Error(`Queuing ${videoId} failed: ${error.message}`);
    }

    const fetched = await fetchTranscript(videoId);
    await recordCall(learn, videoId, fetched, options.trigger);
    result.credits += fetched.ok ? 1 : fetched.credits;
    const at = new Date(now());

    if (fetched.ok && fetched.cues.length > 0) {
      const path = storagePathFor(videoId);
      const upload = await learn.storage
        .from(TRANSCRIPT_BUCKET)
        .upload(path, encodeTranscript(videoId, fetched.language, fetched.cues, at), {
          contentType: 'application/gzip',
          upsert: true,
        });
      if (upload.error) throw new Error(`Saving ${videoId}'s transcript failed: ${upload.error.message}`);

      const { error } = await learn
        .from('video_transcripts')
        .update({
          state: 'fetched',
          fetched_at: at.toISOString(),
          language: fetched.language,
          cue_count: fetched.cues.length,
          char_count: fetched.cues.reduce((sum, cue) => sum + cue.text.length, 0),
          storage_path: path,
          last_error: null,
          retry_after: null,
        })
        .eq('video_id', videoId);
      if (error) throw new Error(`Recording ${videoId}'s transcript failed: ${error.message}`);

      result.fetched += 1;
      result.segments += await writeSegmentsFor(learn, videoId, fetched.cues);
      continue;
    }

    const failure: Extract<TranscriptResult, { ok: false }> = fetched.ok
      ? { ok: false, outcome: 'no-transcript', status: 200, credits: 1, retryable: false, detail: 'the transcript came back empty' }
      : fetched;
    const { update, stopRun } = afterFailure(failure, row?.attempts ?? 0, at);
    const { error } = await learn.from('video_transcripts').update(update).eq('video_id', videoId);
    if (error) throw new Error(`Recording ${videoId}'s state failed: ${error.message}`);

    if (update.state === 'none') {
      result.none += 1;
      result.segments += await writeSegmentsFor(learn, videoId, null);
    } else if (update.state === 'failed') {
      result.failed += 1;
    }

    if (stopRun) {
      result.stopped = {
        reason: failure.outcome === 'rate-limited' ? 'rate-limited' : 'account',
        detail: failure.detail,
      };
      break;
    }
  }

  return result;
}

/** A stored transcript, or null if there is none. */
export async function loadTranscript(
  learn: LearnSupabaseClient,
  videoId: string,
): Promise<{ language: string | null; cues: TranscriptCue[] } | null> {
  if (!isVideoId(videoId)) return null;
  const { data, error } = await learn.storage.from(TRANSCRIPT_BUCKET).download(storagePathFor(videoId));
  if (error || !data) return null;
  return decodeTranscript(new Uint8Array(await data.arrayBuffer()));
}
