import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { sumByModel, type SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { rateClipsFor } from './rate-jev';
import { CLIP_COLUMNS, peopleWithClips, withWords, type ClipRow } from './score-run';

/**
 * Rating clips from the library run, after scoring.
 *
 * Which clips: every clip not yet shown and not refused that has no rating,
 * newest cut first. The library run cuts clips and then scores and rates
 * them, so a clip cut on a run is rated on the same run where time allows.
 * Clips cut before ratings existed come up the same way, RATINGS_PER_RUN at a
 * time per person, until every unseen clip has one. A clip already shown is
 * not rated: the stream only ranks clips it has not played.
 *
 * The clip's words are read from the stored transcript, as the scoring run
 * reads them (withWords in score-run.ts). Runs with the service client, so
 * every read and write names the person.
 */

/** Clips rated per person per scheduled run. Jev answers in under a second each, eight at a time. */
export const RATINGS_PER_RUN = 120;

export type RatePassResult = {
  rated: number;
  byJev: number;
  byHaiku: number;
  /** Clips that came up and got no rating; tried again next run. */
  unrated: number;
  /** Haiku calls, or whole people, that failed. */
  failed: number;
  stopped: string | null;
};

/** The unseen clips with no rating, newest cut first. */
export async function clipsToRate(learn: LearnSupabaseClient, userId: string, limit: number): Promise<ClipRow[]> {
  const { data, error } = await learn
    .from('video_clips')
    .select(CLIP_COLUMNS)
    .eq('user_id', userId)
    .is('rated_at', null)
    .is('shown_at', null)
    .is('not_interested_at', null)
    .order('cut_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Reading the clips to rate failed: ${error.message}`);
  return (data ?? []) as unknown as ClipRow[];
}

/** Rate every person's waiting clips, until the cap or the time runs out. */
export async function rateClips(
  learn: LearnSupabaseClient,
  options: {
    /** Null leaves the clips Jev could not rate for a run that has a key. */
    client: Pick<Anthropic, 'messages'> | null;
    /** Whether a person's text may go to Jev (jevEnabledFor). */
    jevEnabled: (userId: string) => Promise<boolean>;
    /** No call is started after this. */
    deadline: number;
    /** A Haiku call still running at this point is abandoned. */
    hardDeadline?: number;
    limit?: number;
    /** Once per model per person per run. */
    onSpend?: (userId: string, report: SpendReport) => void;
    jevApiKey?: string | null;
    jevFetch?: typeof fetch;
    now?: () => Date;
  },
): Promise<RatePassResult> {
  const result: RatePassResult = { rated: 0, byJev: 0, byHaiku: 0, unrated: 0, failed: 0, stopped: null };
  const now = options.now ?? (() => new Date());
  for (const userId of await peopleWithClips(learn)) {
    if (Date.now() >= options.deadline) {
      result.stopped = 'out of time; the next run carries on';
      break;
    }
    try {
      const rows = await clipsToRate(learn, userId, options.limit ?? RATINGS_PER_RUN);
      if (rows.length === 0) continue;
      const reports: SpendReport[] = [];
      const got = await rateClipsFor({
        clips: await withWords(learn, rows),
        jevEnabled: await options.jevEnabled(userId),
        client: options.client,
        onSpend: (report) => reports.push(report),
        deadline: options.deadline,
        hardDeadline: options.hardDeadline,
        jevApiKey: options.jevApiKey,
        jevFetch: options.jevFetch,
      });
      for (const report of sumByModel(reports)) options.onSpend?.(userId, report);

      const stamp = now().toISOString();
      for (const rating of got.ratings) {
        const { error } = await learn
          .from('video_clips')
          .update({
            rating_educational: rating.educational,
            rating_entertainment: rating.entertainment,
            rating_quality: rating.quality,
            rating: rating.rating,
            rated_by: rating.by,
            rated_at: stamp,
          })
          .eq('id', rating.id)
          .eq('user_id', userId);
        if (error) throw new Error(`Storing a clip's rating failed: ${error.message}`);
        result.rated += 1;
        if (rating.by === 'jev') result.byJev += 1;
        else result.byHaiku += 1;
      }
      result.unrated += got.unrated.length;
      result.failed += got.failed;
    } catch (error) {
      result.failed += 1;
      console.error(`[clips] rating for ${userId}`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
