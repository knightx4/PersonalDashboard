/**
 * Every goal run, for the Runs page under Goals (plan #1012).
 *
 * One goals.runs row per run: "Work on this" or a comment on a goal (job
 * `goal`), the morning run (`daily`), the weekly run (`weekly`), or answers
 * to questions on a goal (`reshape`, plan #1017). The page
 * reads them newest first and says, for each, what started it, what it was
 * on, how it ended, how long it took, and its summary or its error.
 *
 * Pure: the store in runs-store.ts reads the rows, this file says what they
 * mean.
 */
import { RUN_QUIET_MS, type GoalRunStatus } from '@/lib/goals/shaping';

export type RunJob = 'goal' | 'daily' | 'weekly' | 'reshape';

/** One goals.runs row with the item it was on, as the Runs page reads it. */
export type RunListing = {
  id: string;
  job: RunJob;
  status: GoalRunStatus;
  /** ISO instant the run row was written, which is when it started. */
  createdAt: string;
  endedAt: string | null;
  summary: string | null;
  error: string | null;
  /** The goal or step it was on; null for a morning or weekly run, or when that item was deleted. */
  item: { id: string; title: string; level: 'goal' | 'step' } | null;
};

/** What started each kind of run, as the page names it. */
export const JOB_LABELS: Record<RunJob, string> = {
  goal: 'Work on this',
  daily: 'Morning run',
  weekly: 'Weekly run',
  reshape: 'After your answers',
};

/**
 * How a run ended, in a word or two. A started run past the quiet window is
 * one whose session died without writing back, the same reading the goal
 * page gives its latest run.
 */
export type RunOutcome = 'done' | 'failed' | 'running' | 'silent';

export function runOutcome(run: Pick<RunListing, 'status' | 'createdAt'>, now: number): RunOutcome {
  if (run.status === 'done') return 'done';
  if (run.status === 'failed') return 'failed';
  return now - Date.parse(run.createdAt) < RUN_QUIET_MS ? 'running' : 'silent';
}

export const OUTCOME_LABELS: Record<RunOutcome, string> = {
  done: 'Finished',
  failed: 'Failed',
  running: 'Still running',
  silent: 'Never reported back',
};

/**
 * How long a run took, from its row being written to its end, or null when
 * it has not ended. Under a minute reads as seconds, under an hour as
 * minutes, and anything longer as hours and minutes.
 */
export function runDuration(run: Pick<RunListing, 'createdAt' | 'endedAt'>): string | null {
  if (!run.endedAt) return null;
  const ms = Date.parse(run.endedAt) - Date.parse(run.createdAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** The raw row PostgREST returns, with the embedded item. */
export type RunRowWithItem = {
  id: string;
  job: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  summary: string | null;
  error: string | null;
  item: { id: string; title: string; level: string } | null;
};

function isJob(value: string): value is RunJob {
  return value === 'goal' || value === 'daily' || value === 'weekly' || value === 'reshape';
}

function isStatus(value: string): value is GoalRunStatus {
  return value === 'started' || value === 'done' || value === 'failed';
}

/**
 * Shape the rows for the page, newest first. The table's checks keep job and
 * status to the values above; a row outside them is kept rather than hidden,
 * read as a goal run that is still started, so every run still appears.
 */
export function toRunListings(rows: readonly RunRowWithItem[]): RunListing[] {
  return rows
    .map((row): RunListing => ({
      id: row.id,
      job: isJob(row.job) ? row.job : 'goal',
      status: isStatus(row.status) ? row.status : 'started',
      createdAt: row.created_at,
      endedAt: row.ended_at,
      summary: row.summary,
      error: row.error,
      item: row.item
        ? { id: row.item.id, title: row.item.title, level: row.item.level === 'goal' ? 'goal' : 'step' }
        : null,
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
