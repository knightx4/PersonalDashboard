import type { SupabaseClient } from '@supabase/supabase-js';

/** Jobs with no heartbeat for this long are treated as dead. */
export const STALE_RUNNING_MS = 15 * 60 * 1000;

/** Queued jobs that never became running — after() likely crashed. */
export const STALE_QUEUED_MS = 2 * 60 * 1000;

export type SyncJobStaleRow = {
  id: string;
  status: string;
  messages_seen: number;
  updated_at: string;
};

export function isFreshActiveJob(
  job: Pick<SyncJobStaleRow, 'status' | 'updated_at'> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!job) return false;
  if (job.status !== 'running' && job.status !== 'queued') return false;
  const updatedAt = new Date(job.updated_at).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  const age = nowMs - updatedAt;
  if (job.status === 'queued') return age < STALE_QUEUED_MS;
  return age < STALE_RUNNING_MS;
}

/**
 * Mark a stuck queued/running job as failed so the UI unlocks.
 * Returns the updated row fields when a change was made.
 */
export async function failStaleSyncJob(
  supabase: SupabaseClient,
  job: SyncJobStaleRow,
  nowMs = Date.now(),
): Promise<{ status: 'failed'; error: string; finished_at: string; updated_at: string } | null> {
  if (isFreshActiveJob(job, nowMs)) return null;
  if (job.status !== 'running' && job.status !== 'queued') return null;

  const finished_at = new Date(nowMs).toISOString();
  const error =
    job.status === 'queued' && job.messages_seen === 0
      ? 'Import never started. Try again — if this keeps happening, check server logs.'
      : 'Import stalled and was marked failed. Try Import or Reset & re-scan.';

  await supabase
    .from('sync_jobs')
    .update({
      status: 'failed',
      error,
      finished_at,
      updated_at: finished_at,
    })
    .eq('id', job.id)
    .in('status', ['queued', 'running']);

  return { status: 'failed', error, finished_at, updated_at: finished_at };
}
