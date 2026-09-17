/**
 * What a run has to show for itself.
 *
 * A claimed step said "In progress" and gave a number of minutes, and that is
 * the whole of what the page could tell you: a row forty minutes in with
 * nothing pushed and a row forty minutes in that has closed two steps read
 * identically. `liveness.ts` turns the same facts into one word for the health
 * column -- pushing, quiet, stopped -- and a word is the right size for a
 * column and the wrong size for the step you have opened on purpose.
 *
 * So this is the evidence behind that word, in the three forms a session
 * leaves behind: what it last pushed, which steps closed after it was fired,
 * and what it raised. Pure and browser-safe, next to `run-end.ts` for the same
 * reason -- `runs.ts` is server-only and the page draws this in the browser.
 *
 * Nothing here asks GitHub. The push comes off the reading stored on the run
 * row (#568, written by the route in #569), so a run nobody has asked about
 * says that rather than reading as a run that pushed nothing. The two are
 * different facts and this file keeps them apart.
 */
import { elapsedSince } from './elapsed';
import { refusalStanding } from './liveness';
import { RUN_JOB_LABEL, type LastRun, type RunJob, type RunStatus, type StoredRunReading } from './run-end';

/**
 * A step, as far as "did this run close it" needs one.
 *
 * Structural, so both a `PlanNode` and the page's lighter catalog entry
 * satisfy it and nothing here has to import the loader. The page hands over
 * the catalog: the tree it draws is narrowed by the view, and the step a run
 * closed an hour ago is exactly the row the Open view has filtered out.
 */
export type StepClosure = {
  number: number;
  title: string;
  status: string;
  completedAt: string | null;
};

/** A raise, as far as "did this run file it" needs one. */
export type RunRaise = {
  id: string;
  title: string;
  /**
   * What the session wrote about where the raise came from, `plan #501` being
   * the shape `scripts/plan.ts` writes. Free text, and null on a raise filed
   * from somewhere that names no step.
   */
  source: string | null;
  createdAt: string;
};

/** The steps named in a raise's source, `plan #501 re-shape` being two words and one number. */
export function sourceNumbers(source: string | null | undefined): number[] {
  if (!source) return [];
  return [...source.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

function at(iso: string | null | undefined): number {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(time) ? time : NaN;
}

/**
 * The steps among these that closed at or after the instant a run was fired.
 *
 * Oldest first, so the list reads in the order the run did the work. A step
 * that closed before the run started belongs to an earlier one and says
 * nothing about this one -- the same cut `runEnd` makes when it decides
 * whether a closure was this run's doing.
 */
export function stepsClosedSince(
  steps: readonly StepClosure[],
  startedAt: string,
): StepClosure[] {
  const fired = at(startedAt);
  if (!Number.isFinite(fired)) return [];
  return steps
    .filter((step) => {
      const closed = at(step.completedAt);
      return Number.isFinite(closed) && closed >= fired;
    })
    .sort((a, b) => at(a.completedAt) - at(b.completedAt));
}

/**
 * The raises among these that a run filed: named one of its steps, and filed
 * after it was fired.
 *
 * Both halves are needed. The time alone would hand a run every raise anybody
 * filed while it was going, and the step alone would hand it the ones an
 * earlier run filed against the same step.
 */
export function raisesFiledSince(
  raises: readonly RunRaise[],
  numbers: readonly number[],
  startedAt: string,
): RunRaise[] {
  const fired = at(startedAt);
  if (!Number.isFinite(fired) || numbers.length === 0) return [];
  const wanted = new Set(numbers);
  return raises
    .filter((raise) => {
      const filed = at(raise.createdAt);
      if (!Number.isFinite(filed) || filed < fired) return false;
      return sourceNumbers(raise.source).some((number) => wanted.has(number));
    })
    .sort((a, b) => at(a.createdAt) - at(b.createdAt));
}

/** Everything the page says about one run, gathered once. */
export type RunWork = {
  job: RunJob;
  status: RunStatus;
  startedAt: string;
  /** Whether GitHub has been asked about this run at all. */
  checked: boolean;
  /** The newest push it had made when GitHub was last asked. */
  push: StoredRunReading['lastPush'];
  /** Why GitHub refused, when it did. */
  refusal: string | null;
  /** Steps that closed after it was fired, oldest first. */
  closed: StepClosure[];
  /** Raises it filed, oldest first. */
  raises: RunRaise[];
};

/**
 * What one run has done, from the run row and the rows around it.
 *
 * `steps` is the row the run was sent at and everything beneath it, which is
 * as far as a run's work can reach: a step run closes its own sub-steps and a
 * feature batch closes the steps under that feature. Handed in rather than
 * looked up, because the page already has the subtree and the CLI has the same
 * rows from its own query.
 */
export function runWork(input: {
  run: LastRun;
  steps: readonly StepClosure[];
  raises: readonly RunRaise[];
}): RunWork {
  const { run } = input;
  const closed = stepsClosedSince(input.steps, run.createdAt);
  return {
    job: run.job,
    status: run.status,
    startedAt: run.createdAt,
    checked: run.reading !== null,
    push: run.reading?.lastPush ?? null,
    refusal: run.reading?.refusal ?? null,
    closed,
    raises: raisesFiledSince(
      input.raises,
      input.steps.map((step) => step.number),
      run.createdAt,
    ),
  };
}

/** Nothing a run could have produced is on record. */
export function workIsEmpty(work: RunWork): boolean {
  return !work.push && work.closed.length === 0 && work.raises.length === 0;
}

/** `2026-09-17T14:02:11Z` as `2026-09-17 14:02`, the stamp the badge uses. */
function stamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

/**
 * How long ago, or nothing when the clock has not started.
 *
 * `now` of 0 is the pre-mount value every other reading here treats as "no
 * time has passed", so the server render and the first client render agree.
 */
function ago(iso: string, now: number): string | null {
  if (now === 0) return null;
  const elapsed = elapsedSince(iso, now);
  return elapsed === 'just now' ? null : elapsed;
}

/** Which run this is and when it started. */
export function runStartedLine(work: RunWork, now: number): string {
  const label = RUN_JOB_LABEL[work.job];
  const when = stamp(work.startedAt);
  if (work.status === 'failed') return `${label} started ${when} and stopped.`;
  if (work.status === 'finished') return `${label} started ${when} and finished.`;
  const going = ago(work.startedAt, now);
  return going ? `${label} started ${when}, going ${going}.` : `${label} started ${when}.`;
}

/**
 * What the last push was.
 *
 * The subject is the useful half -- it is the step the run was on, in the
 * session's own words -- and it is the half most likely to be missing: the
 * activity listing GitHub answers with carries a branch and a sha and no
 * commit message, so a reading written without looking the commit up has only
 * the sha. Both fall back in order, and a push with neither still says when.
 */
export function pushLine(push: NonNullable<StoredRunReading['lastPush']>, now: number): string {
  const when = ago(push.at, now);
  const head = when ? `Last pushed ${when} ago` : `Last pushed ${stamp(push.at)}`;
  if (push.subject) return `${head}: ${push.subject}`;
  if (push.sha) return `${head}, ${push.sha.slice(0, 7)}`;
  return head;
}

/**
 * The steps it closed, named.
 *
 * A dropped step says so: it closed, and the run closing it decided against
 * it rather than building it, which is not the same report.
 */
export function closedLine(work: RunWork): string | null {
  if (work.closed.length === 0) return null;
  const steps = work.closed
    .map((step) => `#${step.number} ${step.title}${step.status === 'dropped' ? ' (dropped)' : ''}`)
    .join(', ');
  return `Closed ${steps}`;
}

/** What it raised, by title, in the order it asked. */
export function raisedLine(work: RunWork): string | null {
  if (work.raises.length === 0) return null;
  return `Raised: ${work.raises.map((raise) => raise.title).join('; ')}`;
}

/**
 * Why GitHub would not say what this run has pushed, in GitHub's own words.
 *
 * Printed as it was stored and not re-worded. `refusalFor` in `lib/plan/ci.ts`
 * writes a whole sentence aimed at the person -- which variable was rejected,
 * what is wrong with it, and what to do about it -- so a line that wrapped it
 * in wording of its own would only push the part worth reading further down.
 *
 * Its own line, shown whether or not the run has anything else to report. A
 * refusal reached the page through `nothingToShowLine` alone before this, so a
 * run that had closed a step and then had its key rejected said nothing about
 * the key at all: the block listed the closure and stopped, and the silence
 * about pushes read as a run that had pushed nothing.
 */
export function refusalLine(work: RunWork): string | null {
  return work.refusal;
}

/**
 * The reason GitHub is refusing, from the runs a surface has in hand.
 *
 * A refusal is not a fact about one run. The key is a setting, so a missing or
 * rejected one makes every run unreadable at once and the route writes the
 * same sentence onto each of them -- which is why it is said once, above the
 * plan, rather than on each row that happens to be open. Null when nothing is
 * being refused, which is the ordinary case.
 *
 * Newest first among the runs that carry one, and only the ones still standing
 * -- `refusalStanding` is what decides that a refusal is current rather than
 * something that was wrong this morning.
 */
export function keyRefusal(runs: Iterable<LastRun>, now: number): string | null {
  let newest: { at: number; refusal: string } | null = null;
  for (const run of runs) {
    const refusal = refusalStanding(run.reading, now);
    if (!refusal || !run.reading) continue;
    const checked = at(run.reading.checkedAt);
    const when = Number.isFinite(checked) ? checked : 0;
    if (!newest || when > newest.at) newest = { at: when, refusal };
  }
  return newest?.refusal ?? null;
}

/**
 * The sentence a run with nothing to show gets.
 *
 * It says which kind of nothing, because they are not the same thing to act
 * on. A run nobody has asked GitHub about may be pushing steadily; a run GitHub
 * refused to answer for cannot be read at all until the key is fixed; a run
 * that was asked about and had pushed nothing is the one worth looking into.
 */
export function nothingToShowLine(work: RunWork, now: number): string {
  const elapsed = ago(work.startedAt, now);
  const since = elapsed ? `in the ${elapsed} since it started` : 'since it started';
  if (work.refusal) {
    return `Nothing closed or raised ${since}, and GitHub would not say what it has pushed.`;
  }
  if (!work.checked) {
    return `Nothing closed or raised ${since}, and nothing has asked GitHub what it has pushed.`;
  }
  return `Nothing pushed, closed or raised ${since}.`;
}
