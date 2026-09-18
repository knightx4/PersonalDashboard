/**
 * When a routine run has stopped, and how to say so.
 *
 * `plan_runs` records the press and nothing after it. Every row is written
 * `started` and nothing ever wrote another status, so a run that fell over at
 * lunchtime and one that was fired a minute ago read identically, and the
 * table could not answer the question it exists for.
 *
 * Nothing calls back. A session does not know its own run, and the fire
 * endpoint is not asked again, so the end of a run has to be read off what the
 * app can see: the step the run was sent at closing, and the clock. Both rules
 * are here, pure, so the page and the sweep that writes the rows agree about
 * what "still going" means.
 *
 * Separate from `runs.ts` because that file is server-only and the plan page
 * shows a run's state in the browser.
 */
import { STALLED_AFTER_MINUTES, elapsedSince } from './elapsed';

/** What a run ends as. `started` is the third state, and the one it begins in. */
export type RunEnd = 'finished' | 'failed';
export type RunStatus = 'started' | RunEnd;

/**
 * Which press started the run.
 *
 * The button, not the routine: two of these fire the same plan routine with
 * different briefs, and what somebody reading the record wants to know is what
 * was asked for. `raise` is the one that is not a button -- writing an answer
 * on a raise is the press -- and it is its own job rather than a `comment` for
 * the same reason: the brief is the raise and the answer, not a question asked
 * on a row.
 *
 * Here rather than in `runs.ts`, which is server-only: the plan page tells a
 * re-shape run from a build run in the browser.
 */
export type RunJob =
  | 'step'
  | 'feature'
  | 'queue'
  | 'reshape'
  | 'shape'
  | 'notes'
  | 'review'
  | 'comment'
  | 'raise';

/**
 * What to call the press, where the page names the run behind a step.
 *
 * Written to start a sentence -- "A feature batch started 14:02" -- because
 * the one place that needs it is the opened step's account of its own run, and
 * a bare noun there reads as a label rather than as the sentence it is part
 * of.
 */
export const RUN_JOB_LABEL: Record<RunJob, string> = {
  step: 'A step run',
  feature: 'A feature batch',
  queue: 'A queue run',
  reshape: 'A re-shape',
  shape: 'A shaping run',
  notes: 'A notes run',
  review: 'A UI review',
  comment: 'A reply to a comment',
  raise: 'An answer on a raise',
};

/**
 * The same press, as a bare noun in machine voice.
 *
 * The status line is lower case with no full stop and no article, so
 * `RUN_JOB_LABEL` cannot be reused there: "A notes run running" is not a line
 * anybody wrote. Two records rather than one string mangled at the call site,
 * because a tenth job should fail the typecheck in both places.
 */
export const RUN_JOB_NOUN: Record<RunJob, string> = {
  step: 'step run',
  feature: 'feature batch',
  queue: 'queue run',
  reshape: 're-shape',
  shape: 'shaping run',
  notes: 'notes run',
  review: 'ui review',
  comment: 'comment reply',
  raise: 'raise answer',
};

/**
 * How long a run may say nothing before it is counted as gone.
 *
 * The same two hours a claim on a step gets, because it is the same question
 * asked from the other side: a session that has not closed its step and has
 * not been heard from since lunchtime is not working, whichever row you read
 * it off.
 */
export const RUN_QUIET_AFTER_MINUTES = STALLED_AFTER_MINUTES;

/**
 * What GitHub last said about a run, as the run row keeps it.
 *
 * The reading `lib/plan/liveness.ts` works out, stored so that whoever reads
 * the run next does not have to work it out again. #563 settled that one route
 * asks GitHub and writes the answer here, and that the plan page, the terminal
 * tool and a session's brief all read what it wrote.
 *
 * The shape says what the columns say. There being a reading at all is
 * `github_checked_at` -- so no reading is `null` here, not a reading with
 * everything empty -- and `lastPush` is null within a reading when GitHub
 * answered and the run had pushed nothing. Those are different facts: one is
 * nobody having looked, the other is having looked and seen silence.
 */
export type StoredRunReading = {
  /** When GitHub was last asked about this run. */
  checkedAt: string;
  /** The newest push the run had made when it was asked, or null for none. */
  lastPush: {
    at: string;
    /** The commit that push landed. Null when only the time was recorded. */
    sha: string | null;
    /** That commit's first line, for saying what the push was. */
    subject: string | null;
  } | null;
  /** Why GitHub refused, when it did. Null on a request that answered. */
  refusal: string | null;
};

/** The last run against one step, as the plan page reads it. */
export type LastRun = {
  status: RunStatus;
  createdAt: string;
  /** Why it did not finish. Null on every run that is going or that did. */
  error: string | null;
  /** Which press started it. What tells a re-shape from a build. */
  job: RunJob;
  /** What GitHub last said about it, or null while nothing has asked. */
  reading: StoredRunReading | null;
};

/** The five columns a stored reading is spread across. */
export type RunReadingColumns = {
  github_checked_at: string | null;
  last_push_at: string | null;
  last_push_sha: string | null;
  last_push_subject: string | null;
  github_error: string | null;
};

/**
 * The stored reading on a run row, or null when nothing has asked about it.
 *
 * One place that turns the five columns into the shape the app reads, because
 * the route that writes them, the page, the send guard and the sweep would
 * otherwise each decide for themselves what a half-filled row means. The
 * database will not produce one -- `plan_runs_push_needs_check_ck` and
 * `plan_runs_commit_needs_push_ck` refuse a push nothing asked about and a
 * commit with no push -- but a row read through an older select or a null
 * column from before the migration still has to land somewhere sensible, and
 * that is here: without `github_checked_at` there is no reading.
 */
export function storedReading(row: Partial<RunReadingColumns>): StoredRunReading | null {
  if (!row.github_checked_at) return null;
  return {
    checkedAt: row.github_checked_at,
    lastPush: row.last_push_at
      ? {
          at: row.last_push_at,
          sha: row.last_push_sha ?? null,
          subject: row.last_push_subject ?? null,
        }
      : null,
    refusal: row.github_error ?? null,
  };
}

/** What the columns hold, so nothing longer than a column takes is sent. */
const SHA_LIMIT = 64;
const SUBJECT_LIMIT = 500;
const REFUSAL_LIMIT = 500;

/** A value worth storing, or null. An empty string is not a value. */
function text(value: string | null | undefined, limit: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/**
 * A reading to write down, with the one rule about what a refusal means.
 *
 * A refusal carries no push. GitHub either answered or it did not, so a row
 * holding both would be two readings at once -- a push from the last time
 * somebody got through, a refusal from this time -- and `readingTrusted` sets
 * the whole reading aside on the refusal anyway, so the push beside it could
 * only mislead whoever read it. What a refusal leaves behind is the answer to
 * "when was this asked" and "what did GitHub say", which is what #566 shows.
 */
export function readingFor(input: {
  checkedAt: string;
  lastPush?: StoredRunReading['lastPush'];
  refusal?: string | null;
}): StoredRunReading {
  const refusal = text(input.refusal, REFUSAL_LIMIT);
  return {
    checkedAt: input.checkedAt,
    lastPush: refusal ? null : (input.lastPush ?? null),
    refusal,
  };
}

/**
 * The five columns a reading is written to.
 *
 * The write-side twin of `storedReading`, here beside it so that what the
 * route writes and what the page reads back are worked out in one place. Every
 * reading sets `github_checked_at`, which is what the three check constraints
 * on `plan_runs` require and what makes "nobody has asked" a different fact
 * from "asked, and it had pushed nothing".
 */
export function readingColumns(reading: StoredRunReading): RunReadingColumns {
  return {
    github_checked_at: reading.checkedAt,
    last_push_at: reading.lastPush?.at ?? null,
    last_push_sha: text(reading.lastPush?.sha, SHA_LIMIT),
    last_push_subject: text(reading.lastPush?.subject, SUBJECT_LIMIT),
    github_error: text(reading.refusal, REFUSAL_LIMIT),
  };
}

/**
 * The runs the page loaded, with fresher readings written over them.
 *
 * What the browser does with the route's answer: the rows were drawn from what
 * was stored when the page rendered, and a reading taken a moment later
 * replaces the one on the run it is about. Only the steps the page already has
 * a run for -- a reading about a run it never loaded has nothing to attach to,
 * and inventing a `LastRun` from it would be inventing the press behind it.
 */
export function withReadings(
  runs: Readonly<Record<string, LastRun>>,
  readings: Readonly<Record<string, StoredRunReading>>,
): Record<string, LastRun> {
  const merged: Record<string, LastRun> = { ...runs };
  for (const [stepId, reading] of Object.entries(readings)) {
    const run = merged[stepId];
    if (run) merged[stepId] = { ...run, reading };
  }
  return merged;
}

/**
 * Whether a feature is being re-read against the answers just given.
 *
 * Answering the last open question under a feature fires a re-shape at it, and
 * that run takes a few minutes to assess what was settled, propose what it
 * changes and clear what it made pointless. The plan said nothing about that
 * window: the questions went green, the feature went back to reading like
 * ordinary work, and Send was live on steps a run was about to rewrite.
 *
 * So it is a state of its own, read off the run that is doing it -- the same
 * `plan_runs` row the answer wrote, still `started` and not yet past the
 * cutoff. `runEnd` decides "still going" for every other reading of a run and
 * decides it here too, because two answers to that would disagree by next
 * month.
 *
 * `now` of 0 is the clock's pre-mount value, the same rule as everywhere else:
 * nothing has aged out at that instant, so the server and the first client
 * render agree.
 */
export function isResolvingAnswers(
  // Only the three fields the rule reads, so a caller that selected the status
  // and the job does not have to invent a GitHub reading it never asked for.
  run: Pick<LastRun, 'status' | 'createdAt' | 'job'> | null | undefined,
  now: number,
): boolean {
  if (!run || run.job !== 'reshape') return false;
  return runEnd(run, null, now) === null && run.status === 'started';
}

/**
 * What a run that still reads `started` should be written back as, or null
 * while it may still be working.
 *
 * A step closing after the run was fired is the one piece of evidence a
 * session leaves: it was sent at that step, and that step is now closed, so
 * the run did what it was for. Everything else is the clock — past the cutoff
 * with no step closed, nothing has been heard from it and it is not coming
 * back.
 *
 * `now` of 0 is the clock's pre-mount value, so nothing ends at that instant.
 */
export function runEnd(
  run: { status: string; createdAt: string },
  step: { completedAt: string | null } | null,
  now: number,
): RunEnd | null {
  if (run.status !== 'started') return null;
  if (now === 0) return null;

  const fired = new Date(run.createdAt).getTime();
  const closed = step?.completedAt ? new Date(step.completedAt).getTime() : null;
  if (closed !== null && closed >= fired) return 'finished';

  return (now - fired) / 60_000 >= RUN_QUIET_AFTER_MINUTES ? 'failed' : null;
}

/**
 * The reason written on a run the cutoff caught.
 *
 * `failed` is the same status a press that never started gets, so the reason
 * is what tells the two apart: 401 from Anthropic on one, silence on the
 * other. It says how long the silence ran because that is what somebody
 * deciding whether to send the step again wants to know.
 */
export function runQuietNote(createdAt: string, now: number): string {
  return `Nothing was heard from this run for ${elapsedSince(createdAt, now)}.`;
}

/** What the plan page says about the last run against a step. */
export function lastRunLine(run: LastRun, now: number): string {
  if (run.status === 'finished') return 'Last run finished';
  if (run.status === 'failed') {
    return `Last run stopped: ${run.error ?? 'no reason recorded'}`;
  }
  return now === 0 ? 'A run is going' : `A run has been going ${elapsedSince(run.createdAt, now)}`;
}
