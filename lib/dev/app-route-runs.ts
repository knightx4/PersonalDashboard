import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The run log of lib/dev/app-route.ts as the Dev settings page lists it
 * (plan #3070.4). Only what the list shows is read: the stored result and the
 * query stay in the table, so a hundred-kilobyte body is never sent to the
 * page, and no secret is stored in the row to begin with.
 */
export type AppRouteRunStatus = 'running' | 'ok' | 'failed' | 'refused';

export type AppRouteRunRow = {
  id: string;
  askedBy: string;
  path: string;
  status: AppRouteRunStatus;
  httpStatus: number | null;
  startedAt: string;
  endedAt: string | null;
  resultBytes: number | null;
  error: string | null;
};

/** How many of the latest runs the list shows. */
export const APP_ROUTE_RUNS_SHOWN = 25;

const STATUSES: readonly string[] = ['running', 'ok', 'failed', 'refused'];

/** The latest runs, newest first, for the signed-in owner (RLS keeps it to their rows). */
export async function loadAppRouteRuns(
  supabase: SupabaseClient,
  userId: string,
  limit = APP_ROUTE_RUNS_SHOWN,
): Promise<AppRouteRunRow[]> {
  const { data, error } = await supabase
    .from('app_route_runs')
    .select('id, asked_by, path, status, http_status, started_at, ended_at, result_bytes, error')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the app route runs: ${error.message}`);
  return (data ?? [])
    .filter((row) => STATUSES.includes(row.status as string))
    .map((row) => ({
      id: row.id as string,
      askedBy: row.asked_by as string,
      path: row.path as string,
      status: row.status as AppRouteRunStatus,
      httpStatus: (row.http_status as number | null) ?? null,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
      resultBytes: (row.result_bytes as number | null) ?? null,
      error: (row.error as string | null) ?? null,
    }));
}

/** 0 B, 840 B, 12 KB, 1.2 MB. */
export function bytesWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** How long a run took, such as 450 ms, 12 s or 4 min 5 s; null until it has ended. */
export function tookWords(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const ms = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  if (!Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return rest === 0 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 60)} min ${rest} s`;
}
