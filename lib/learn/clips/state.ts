import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What the person did with a clip, written as it happens (plan #1399).
 *
 * The player (#1400) wraps these in server actions. Each takes the person's
 * own client, so RLS limits it to their clips; a clip id that is not theirs
 * updates nothing and throws "not found". Each writes the latest of its kind,
 * overwriting the one before.
 *
 * Marking a clip shown also freezes its score: the scoring run
 * (score-run.ts) only rescores clips never shown.
 */

const NOT_FOUND = 'That clip was not found.';

async function write(learn: LearnSupabaseClient, clipId: string, fields: Record<string, unknown>, what: string) {
  const { data, error } = await learn.from('video_clips').update(fields).eq('id', clipId).select('id');
  if (error) throw new Error(`${what} failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error(NOT_FOUND);
}

/** Whole seconds, never negative; null for a value that is not a number. */
function wholeSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

/**
 * Call when a clip starts playing. Sets shown_at, adds one to show_count and
 * clears watched_seconds, which belongs to the showing before.
 */
export async function markClipShown(learn: LearnSupabaseClient, clipId: string, at: Date = new Date()): Promise<void> {
  const { data, error } = await learn.from('video_clips').select('show_count').eq('id', clipId).maybeSingle();
  if (error) throw new Error(`Reading the clip failed: ${error.message}`);
  if (!data) throw new Error(NOT_FOUND);
  const count = (data as { show_count: number }).show_count ?? 0;
  await write(
    learn,
    clipId,
    { shown_at: at.toISOString(), show_count: count + 1, watched_seconds: null },
    'Marking the clip shown',
  );
}

/** Call when a clip plays to its end. Counts for its channel and theme in the picker. */
export async function markClipFinished(
  learn: LearnSupabaseClient,
  clipId: string,
  watchedSeconds?: number | null,
  at: Date = new Date(),
): Promise<void> {
  const fields: Record<string, unknown> = { finished_at: at.toISOString() };
  const watched = wholeSeconds(watchedSeconds);
  if (watched !== null) fields.watched_seconds = watched;
  await write(learn, clipId, fields, 'Marking the clip finished');
}

/**
 * Call when the person swipes past a clip before its end, with how many
 * seconds of it they watched. Under EARLY_SKIP_SECONDS (rank.ts) counts
 * against its channel and theme. The clip may come back after two weeks.
 */
export async function markClipSkipped(
  learn: LearnSupabaseClient,
  clipId: string,
  watchedSeconds: number | null,
  at: Date = new Date(),
): Promise<void> {
  await write(
    learn,
    clipId,
    { skipped_at: at.toISOString(), watched_seconds: wholeSeconds(watchedSeconds) },
    'Marking the clip skipped',
  );
}

/** Call when the person saves a clip, or un-saves it with saved false. Saving counts for its channel and theme. */
export async function markClipSaved(
  learn: LearnSupabaseClient,
  clipId: string,
  saved = true,
  at: Date = new Date(),
): Promise<void> {
  await write(learn, clipId, { saved_at: saved ? at.toISOString() : null }, saved ? 'Saving the clip' : 'Un-saving the clip');
}

/** Call when the person says not interested. The clip never plays again. */
export async function markClipNotInterested(
  learn: LearnSupabaseClient,
  clipId: string,
  at: Date = new Date(),
): Promise<void> {
  await write(learn, clipId, { not_interested_at: at.toISOString() }, 'Marking the clip not interested');
}
