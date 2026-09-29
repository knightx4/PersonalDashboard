import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadTranscript } from './transcripts';
import { SUMMARY_PROMPT_SINCE, transcriptText, writeVideoSummary } from './video-summary';

/**
 * Writing the summaries on your list, from the library run (plan #1069).
 *
 * A video is summarised once its transcript is stored, and not before: the
 * run never writes one from the description. It is summarised again when the
 * summary it has predates SUMMARY_PROMPT_SINCE. A transcript with nothing to
 * summarise is recorded with `summarised_at` set and no summary, so the run
 * does not ask again.
 *
 * Runs with the service client, so every read and write names the person.
 */

const BATCH = 200;
/** Calls in flight at once: enough to get through a new playlist in a run or two. */
const CONCURRENCY = 4;

type Row = {
  user_id: string;
  video_id: string;
  summary_from: string | null;
  summarised_at: string | null;
  item: { title: string; author: string | null; duration_seconds: number | null; provider: { name: string } | { name: string }[] | null } | null;
};

type Candidate = { userId: string; videoId: string; title: string; channel: string | null; durationSeconds: number | null };

export type SummaryPassResult = { written: number; tooLittle: number; failed: number; stopped: string | null };

/**
 * Which rows need a summary: only those with a transcript, and then when there
 * is none yet, it was written from the description, or it predates the
 * current prompt.
 */
export function needsSummary(
  row: { summary_from: string | null; summarised_at: string | null },
  hasTranscript: boolean,
  promptSince: string = SUMMARY_PROMPT_SINCE,
): boolean {
  if (!hasTranscript) return false;
  if (row.summarised_at === null || row.summary_from !== 'transcript') return true;
  return Date.parse(row.summarised_at) < Date.parse(promptSince);
}

async function fetchedTranscripts(learn: LearnSupabaseClient, videoIds: string[]): Promise<Set<string>> {
  const fetched = new Set<string>();
  for (let from = 0; from < videoIds.length; from += BATCH) {
    const { data, error } = await learn
      .from('video_transcripts')
      .select('video_id')
      .eq('state', 'fetched')
      .in('video_id', videoIds.slice(from, from + BATCH));
    if (error) throw new Error(`Reading transcript states failed: ${error.message}`);
    for (const row of (data ?? []) as { video_id: string }[]) fetched.add(row.video_id);
  }
  return fetched;
}

/** Every video on every list that needs a summary, newest on the list first. */
async function candidates(learn: LearnSupabaseClient): Promise<Candidate[]> {
  const { data, error } = await learn
    .from('watch_list')
    .select(
      'user_id, video_id, summary_from, summarised_at, item:catalogue_items!watch_list_item_id_fkey(title, author, duration_seconds, provider:catalogue_providers!catalogue_items_provider_id_fkey(name))',
    )
    .is('left_playlist_at', null)
    .order('added_at', { ascending: false });
  if (error) throw new Error(`Reading the list to summarise failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as Row[]).filter((row) => row.item);
  const fetched = await fetchedTranscripts(learn, [...new Set(rows.map((row) => row.video_id))]);
  return rows
    .filter((row) => needsSummary(row, fetched.has(row.video_id)))
    .map((row) => {
      const item = row.item!;
      const provider = Array.isArray(item.provider) ? item.provider[0] : item.provider;
      return {
        userId: row.user_id,
        videoId: row.video_id,
        title: item.title,
        // Under youtube-list the channel is the author; under a followed channel it is the provider.
        channel: item.author ?? provider?.name ?? null,
        durationSeconds: item.duration_seconds,
      };
    });
}

/** Summarise until the list or the time runs out. */
export async function summariseWatchLists(
  learn: LearnSupabaseClient,
  options: {
    anthropicApiKey: string;
    deadline: number;
    client?: Anthropic;
    /** Called once per call made, with the person the video belongs to. */
    onSpend?: (userId: string, report: SpendReport) => void;
    now?: () => Date;
  },
): Promise<SummaryPassResult> {
  const result: SummaryPassResult = { written: 0, tooLittle: 0, failed: 0, stopped: null };
  const queue = await candidates(learn);
  const now = options.now ?? (() => new Date());

  const one = async (video: Candidate) => {
    const cues = (await loadTranscript(learn, video.videoId))?.cues ?? [];
    const written = await writeVideoSummary({
      video: {
        title: video.title,
        channel: video.channel,
        durationSeconds: video.durationSeconds,
        transcript: transcriptText(cues),
      },
      anthropicApiKey: options.anthropicApiKey,
      client: options.client,
      onSpend: options.onSpend ? (report) => options.onSpend!(video.userId, report) : undefined,
    });
    if (written.outcome === 'failed') {
      result.failed += 1;
      console.error(`[video summary] ${video.videoId}`, written.detail);
      return;
    }
    const stamp = now().toISOString();
    const update =
      written.outcome === 'written'
        ? { summary: written.summary, key_points: written.keyPoints, summary_from: 'transcript', summarised_at: stamp, updated_at: stamp }
        : { summary: null, key_points: null, summary_from: 'transcript', summarised_at: stamp, updated_at: stamp };
    const { error } = await learn
      .from('watch_list')
      .update(update)
      .eq('user_id', video.userId)
      .eq('video_id', video.videoId);
    if (error) throw new Error(`Storing the summary failed: ${error.message}`);
    if (written.outcome === 'written') result.written += 1;
    else result.tooLittle += 1;
  };

  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (Date.now() >= options.deadline) {
        result.stopped = 'out of time; the next run carries on';
        return;
      }
      await one(queue[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return result;
}
