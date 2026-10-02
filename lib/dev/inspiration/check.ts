import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { supabaseMergeStore } from './merge';
import {
  readInspirationVideos,
  supabaseTakeawayStore,
  type InspirationOperation,
  type InspirationRead,
} from './read';
import { CHECK_LOCK_MS } from './lock';
import { loadInspirationTranscript, syncInspiration, type InspirationSync } from './sync';

export { CHECK_LOCK_MS, checkRunning } from './lock';

/**
 * One check of the inspiration playlist (plan #1411, under #1406): read the
 * playlist and fetch the new videos' transcripts (#1408), read each new video
 * for takeaways (#1409), and merge them with the ones already found (#1410).
 * The daily run (`/api/cron/inspiration`) does it for everyone with a playlist
 * set; Check now on the tab does it for the person who pressed it.
 *
 * A check that finds nothing new spends nothing: the sync only fetches
 * transcripts it does not have, the read only reads videos not read yet, and
 * the merge only embeds takeaways that have no vector.
 *
 * Two checks at once could read the same video twice and store its takeaways
 * twice, so a check claims `inspiration_settings.run_started_at` before it
 * starts and clears it when it ends. A second check finds the claim and does
 * nothing. A claim older than CHECK_LOCK_MS belongs to a run that died, and is
 * taken over.
 */

/** What a check touches, narrowed so a test can hold it in memory. */
export type CheckSteps = {
  /** Take the claim; false when another check holds it. */
  claim(userId: string, startedAt: Date): Promise<boolean>;
  /** Clear the claim this check took, and only that one. */
  release(userId: string, startedAt: Date): Promise<void>;
  sync(userId: string): Promise<InspirationSync>;
  /** Null when there is no model key, so nothing can be read. */
  read: ((userId: string) => Promise<InspirationRead>) | null;
};

export type InspirationCheck =
  | { userId: string; ran: false; reason: 'running' }
  | { userId: string; ran: true; sync: InspirationSync | null; read: InspirationRead | null; error: string | null };

/**
 * Run one person's check under the claim. A sync that fails does not stop the
 * read, since videos fetched by an earlier run may still be waiting to be read.
 * The claim is cleared however the check ends.
 */
export async function runInspirationCheck(
  steps: CheckSteps,
  userId: string,
  now: Date = new Date(),
): Promise<InspirationCheck> {
  if (!(await steps.claim(userId, now))) return { userId, ran: false, reason: 'running' };
  const result: InspirationCheck = { userId, ran: true, sync: null, read: null, error: null };
  try {
    try {
      result.sync = await steps.sync(userId);
    } catch (failure) {
      result.error = failure instanceof Error ? failure.message : String(failure);
    }
    if (steps.read) result.read = await steps.read(userId);
  } catch (failure) {
    result.error = failure instanceof Error ? failure.message : String(failure);
  } finally {
    await steps.release(userId, now);
  }
  return result;
}

export type InspirationCheckOptions = {
  /** 'scheduled' for the daily run, 'press' for Check now. */
  trigger: 'press' | 'scheduled';
  /** Without it the playlist is still read and transcripts fetched, but no video is read for takeaways. */
  anthropicApiKey: string | null;
  /** Epoch ms after which no further transcript, video or merge is started. */
  deadline?: number;
  onSpend?: (userId: string, report: SpendReport, operation: InspirationOperation) => void;
};

/** The claim, over the service-role client, filtered by the person. */
export async function claimInspirationCheck(
  learn: LearnSupabaseClient,
  userId: string,
  startedAt: Date,
): Promise<boolean> {
  const stale = new Date(startedAt.getTime() - CHECK_LOCK_MS).toISOString();
  const { data, error } = await learn
    .schema('public')
    .from('inspiration_settings')
    .update({ run_started_at: startedAt.toISOString() })
    .eq('user_id', userId)
    .or(`run_started_at.is.null,run_started_at.lt.${stale}`)
    .select('user_id');
  if (error) throw new Error(`Starting the inspiration check failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function releaseInspirationCheck(learn: LearnSupabaseClient, userId: string, startedAt: Date): Promise<void> {
  const { error } = await learn
    .schema('public')
    .from('inspiration_settings')
    .update({ run_started_at: null })
    .eq('user_id', userId)
    .eq('run_started_at', startedAt.toISOString());
  if (error) throw new Error(`Ending the inspiration check failed: ${error.message}`);
}

/** The steps over the service-role client. `claimed` skips the claim for a caller that has already taken it. */
export function inspirationCheckSteps(
  learn: LearnSupabaseClient,
  options: InspirationCheckOptions,
  claimed = false,
): CheckSteps {
  const store = { ...supabaseTakeawayStore(learn), ...supabaseMergeStore(learn) };
  const loadCues = (videoId: string) => loadInspirationTranscript(learn, videoId);
  const anthropicApiKey = options.anthropicApiKey;
  return {
    claim: claimed ? async () => true : (userId, startedAt) => claimInspirationCheck(learn, userId, startedAt),
    release: (userId, startedAt) => releaseInspirationCheck(learn, userId, startedAt),
    sync: (userId) => syncInspiration(learn, userId, { trigger: options.trigger, deadline: options.deadline }),
    read: anthropicApiKey
      ? (userId) =>
          readInspirationVideos(store, loadCues, userId, {
            anthropicApiKey,
            deadline: options.deadline,
            onSpend: options.onSpend,
          })
      : null,
  };
}

/** The daily run: every person with a playlist set, until the deadline. */
export async function checkInspirationForEveryone(
  learn: LearnSupabaseClient,
  options: InspirationCheckOptions,
): Promise<InspirationCheck[]> {
  const { data, error } = await learn
    .schema('public')
    .from('inspiration_settings')
    .select('user_id')
    .not('youtube_playlist_id', 'is', null);
  if (error) throw new Error(`Reading the inspiration playlists failed: ${error.message}`);

  const steps = inspirationCheckSteps(learn, options);
  const out: InspirationCheck[] = [];
  for (const row of (data ?? []) as { user_id: string }[]) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    try {
      out.push(await runInspirationCheck(steps, row.user_id));
    } catch (failure) {
      out.push({
        userId: row.user_id,
        ran: true,
        sync: null,
        read: null,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }
  return out;
}
