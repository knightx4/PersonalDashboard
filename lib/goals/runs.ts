/**
 * Every goal run, for the Runs page under Goals (plan #1012).
 *
 * One goals.runs row per run: "Work on this" or a comment on a goal (job
 * `goal`), the morning run (`daily`), the weekly run (`weekly`), or answers
 * to questions on a goal (`reshape`, plan #1017), or one step or phase sent
 * from its row (`step`, `phase`, plan #1000), or one step of yours Claude was
 * asked to prepare (`prepare`, plan #1001). The page
 * reads them newest first and says, for each, what started it, what it was
 * on, how it ended, how long it took, and its summary or its error.
 *
 * Pure: the store in runs-store.ts reads the rows, this file says what they
 * mean.
 */
import { formatInstant } from './dates';
import { runIsQuiet, runProgress, type GoalRunStatus } from '@/lib/goals/shaping';

export type RunJob = 'goal' | 'daily' | 'weekly' | 'reshape' | 'step' | 'phase' | 'prepare';

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
  /** When the session last reported, and what it said it was on (plan #1002). */
  lastSeenAt: string | null;
  nowOn: string | null;
  /** The goal or step it was on; null for a morning or weekly run, or when that item was deleted. */
  item: { id: string; title: string; level: 'goal' | 'step' } | null;
};

/** What started each kind of run, as the page names it. */
export const JOB_LABELS: Record<RunJob, string> = {
  goal: 'Work on this',
  daily: 'Morning run',
  weekly: 'Weekly run',
  reshape: 'After your answers',
  step: 'Sent a step',
  phase: 'Sent a phase',
  prepare: 'Prepared a step',
};

/**
 * How a run ended, in a word or two. A started run quiet for longer than
 * RUN_QUIET_MS is one whose session died without writing back; the sweep
 * closes it as failed on the next tick, and until then it reads as silent.
 */
export type RunOutcome = 'done' | 'failed' | 'running' | 'silent';

export function runOutcome(
  run: Pick<RunListing, 'status' | 'createdAt'> & { lastSeenAt?: string | null },
  now: number,
): RunOutcome {
  if (run.status === 'done') return 'done';
  if (run.status === 'failed') return 'failed';
  return runIsQuiet(run, now) ? 'silent' : 'running';
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
  last_seen_at?: string | null;
  now_on?: string | null;
  item: { id: string; title: string; level: string } | null;
};

function isJob(value: string): value is RunJob {
  return (
    value === 'goal' ||
    value === 'daily' ||
    value === 'weekly' ||
    value === 'reshape' ||
    value === 'step' ||
    value === 'phase' ||
    value === 'prepare'
  );
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
      lastSeenAt: row.last_seen_at ?? null,
      nowOn: row.now_on ?? null,
      item: row.item
        ? { id: row.item.id, title: row.item.title, level: row.item.level === 'goal' ? 'goal' : 'step' }
        : null,
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * The line under a run's heading: how it ended, where a running one has got
 * to, when it started, and how long it took. Shared by the Runs page and a
 * run's own page (plan #1013).
 */
export function runMeta(run: RunListing, now: number, timeZone: string): { outcome: RunOutcome; meta: string } {
  const outcome = runOutcome(run, now);
  const took = runDuration(run);
  const progress = outcome === 'running' ? runProgress(run, now) : null;
  const meta = [
    OUTCOME_LABELS[outcome],
    progress,
    formatInstant(run.createdAt, timeZone),
    took ? `took ${took}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { outcome, meta };
}
