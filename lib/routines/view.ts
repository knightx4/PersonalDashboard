/**
 * One row of the Routines pages: a routine from the registry joined with its
 * clock and its latest run, in the words the page shows.
 *
 * Dev and Goals draw the same rows, so a routine reads the same wherever it is
 * listed: how often it runs and when next, when it last ran and how that went,
 * where its results are, and what is still unsettled about it.
 *
 * Pure: the facts come in from lib/routines/store.ts and `now` is passed in.
 */
import { formatClock } from '@/lib/clock';
import { safeTimeZone } from '@/lib/core/timezone';
import { describeCron, nextFire } from './cron';
import { DAILY_CRON, type Routine } from './registry';

/** One pg_cron job as public.routine_schedules() returns it. */
export type ScheduleFact = {
  jobname: string;
  schedule: string;
  active: boolean;
  lastStartedAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
};

/** The latest run a routine recorded. */
export type RunFact = { createdAt: string; status: string; error: string | null };

export type RoutineFacts = {
  /** Null when the jobs could not be read, which is not the same as there being none. */
  schedules: readonly ScheduleFact[] | null;
  /** Latest run per `table:job`. */
  runs: ReadonlyMap<string, RunFact>;
};

export type RoutineView = {
  key: string;
  title: string;
  does: string;
  /** "Every week · next Sun 18 Oct, 3:41 pm". */
  schedule: string;
  /** "Last ran Sun 4 Oct, 3:41 pm · finished", or null when nothing records it. */
  lastRun: string | null;
  failed: boolean;
  /** The reason a failed run gave. */
  error: string | null;
  /** Something wrong with the clock itself: missing, paused, or its last tick failed. */
  warning: string | null;
  results: Routine['results'] | null;
  question: string | null;
  builtBy: number | null;
};

export function runKey(table: string, job: string): string {
  return `${table}:${job}`;
}

function when(iso: string, timeZone: string): string {
  return formatClock(iso, { weekday: 'short', day: 'numeric', month: 'short', timeZone: safeTimeZone(timeZone) });
}

const FAILED = new Set(['failed', 'error']);
const RUNNING = new Set(['started', 'running', 'queued']);

function outcome(status: string): string {
  if (FAILED.has(status)) return 'failed';
  if (RUNNING.has(status)) return 'still running';
  return 'finished';
}

export function routineView(routine: Routine, facts: RoutineFacts, now: number, timeZone: string): RoutineView {
  const clock = routine.clock;
  const job = clock.kind === 'pg_cron' ? facts.schedules?.find((s) => s.jobname === clock.job) : undefined;
  const expression =
    clock.kind === 'daily'
      ? DAILY_CRON
      : clock.kind === 'pg_cron'
        ? (job?.schedule ?? (facts.schedules ? null : clock.expression))
        : null;

  let warning: string | null = null;
  if (clock.kind === 'pg_cron' && facts.schedules) {
    if (!job) warning = `Not scheduled: there is no pg_cron job named ${clock.job}.`;
    else if (!job.active) warning = `Paused: the pg_cron job ${clock.job} is turned off.`;
    else if (job.lastStatus && FAILED.has(job.lastStatus)) {
      warning = `The last tick failed${job.lastMessage ? `: ${job.lastMessage}` : '.'}`;
    }
  }

  const next = expression ? nextFire(expression, now) : null;
  const cadence =
    routine.cadence ??
    (clock.kind === 'claude' ? 'On a schedule set on claude.ai' : expression ? describeCron(expression) : 'Not scheduled');
  const schedule = [
    cadence,
    clock.kind === 'daily' && !routine.cadence ? 'with the morning cron' : null,
    next ? `next ${when(next, timeZone)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let lastRun: string | null = null;
  let failed = false;
  let error: string | null = null;
  if (routine.runs) {
    const run = facts.runs.get(runKey(routine.runs.table, routine.runs.job));
    if (!run) lastRun = 'Has not run yet';
    else {
      const said = outcome(run.status);
      failed = said === 'failed';
      error = failed ? run.error : null;
      lastRun = `Last ran ${when(run.createdAt, timeZone)} · ${said}`;
    }
  } else if (job?.lastStartedAt) {
    lastRun = `Last tick ${when(job.lastStartedAt, timeZone)}`;
  }

  return {
    key: routine.key,
    title: routine.title,
    does: routine.does,
    schedule,
    lastRun,
    failed,
    error,
    warning,
    results: routine.results ?? null,
    question: routine.question ?? null,
    builtBy: routine.builtBy ?? null,
  };
}

/**
 * Every routine's row, reading the clock once. Called from a page rather than
 * inside a component, because reading the clock during render is unstable.
 */
export function routineViews(routines: readonly Routine[], facts: RoutineFacts, timeZone: string): RoutineView[] {
  const now = Date.now();
  return routines.map((routine) => routineView(routine, facts, now, timeZone));
}
