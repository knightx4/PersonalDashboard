/**
 * Starting a routine and writing down that it was started.
 *
 * Every dev button that fires a routine went through `fireFeatureRoutine` and
 * kept nothing: the response was read for its status code, turned into a line
 * for the toast and dropped. So the app could never answer "is anything working
 * on this step" with evidence -- only with the step's own `status` column and a
 * clock, which is why `lib/plan/claims.ts` has to take a claim back on a
 * two-hour guess.
 *
 * This is the one way in now. It fires, then writes a `plan_runs` row naming
 * the step where there is one, the press it came from, the routine it went to
 * and the whole response body. A press that failed is a row as well, with the
 * reason, because a run that never started and a press nobody made are
 * different facts and looked identical before.
 *
 * The write cannot fail the press. By the time it runs the routine is already
 * going, and refusing to say so would leave the person believing nothing had
 * started when something had -- a worse lie than a missing record. A failed
 * insert says so on the server log and the press reports what happened to the
 * fire.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fireFeatureRoutine,
  resolveRoutineId,
  type FireRoutineResult,
  type RoutineTarget,
} from '@/lib/feedback/routine';
import {
  isResolvingAnswers,
  readingColumns,
  readingFor,
  runEnd,
  runQuietNote,
  storedReading,
  type LastRun,
  type RunJob,
  type RunReadingColumns,
  type RunStatus,
  type StoredRunReading,
} from './run-end';
import { commitSubjects, listPushes } from './ci';
import type { RunRaise } from './work';
import {
  abandonedClaim,
  lastPushSince,
  runEndedNote,
  runLiveness,
  type Push,
  type RunEvidence,
  type RunLiveness,
} from './liveness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * Which press started the run.
 *
 * Defined in `run-end.ts` and re-exported here, where it has always been read
 * from. This file is server-only and the plan page names a run's job in the
 * browser, so the vocabulary has to live on the browser-safe side of the pair
 * -- the same reason the rest of the pure run rules are over there.
 */
export type { RunJob } from './run-end';

/** A `plan_runs` row, ready to insert. */
export type RunRow = {
  user_id: string;
  plan_item_id: string | null;
  job: RunJob;
  routine_id: string;
  external_id: string | null;
  status: RunStatus;
  http_status: number | null;
  response: unknown;
  error: string | null;
};

/**
 * How many raises are read for the plan page.
 *
 * Only the ones a run still being drawn could have filed matter, and a run is
 * over after two hours, so this is a generous ceiling rather than a rule --
 * enough that no page has to paginate, small enough that the query stays one
 * cheap read as the queue grows.
 */
const RUN_RAISE_LIMIT = 200;

/** How much of a refusal is worth keeping. The column takes 4000. */
const ERROR_LIMIT = 4000;

/**
 * What a press should be recorded as, from what the fire came back with.
 *
 * Pure, so the rule about which presses count as started and what each row
 * carries is testable without a database or a network.
 */
export function runRowFor(input: {
  userId: string;
  job: RunJob;
  routineId: string | null;
  planItemId?: string | null;
  result: FireRoutineResult;
}): RunRow {
  const { result } = input;
  return {
    user_id: input.userId,
    plan_item_id: input.planItemId ?? null,
    job: input.job,
    routine_id: resolveRoutineId(input.routineId),
    external_id: result.ok ? result.runId : null,
    status: result.ok ? 'started' : 'failed',
    http_status: result.status,
    response: result.body ?? null,
    error: result.ok ? null : result.error.slice(0, ERROR_LIMIT),
  };
}

/**
 * Fire a routine and record the run, in that order.
 *
 * The result is the fire's, unchanged, so a caller reads it exactly as it read
 * `fireFeatureRoutine` before.
 */
export async function startRoutineRun(input: {
  supabase: Db;
  userId: string;
  job: RunJob;
  routine: RoutineTarget;
  /** The step this run is about, when it is about one. */
  planItemId?: string | null;
  /** The brief, appended to the routine's session. */
  text?: string | null;
  fetch?: typeof globalThis.fetch;
}): Promise<FireRoutineResult> {
  const result = await fireFeatureRoutine({
    apiKey: input.routine.token,
    routineId: input.routine.id,
    text: input.text,
    fetch: input.fetch,
  });

  const row = runRowFor({
    userId: input.userId,
    job: input.job,
    routineId: input.routine.id,
    planItemId: input.planItemId,
    result,
  });

  const { error } = await input.supabase.from('plan_runs').insert(row);
  if (error) {
    console.error(`plan_runs insert failed for a ${input.job} run: ${error.message}`);
  }

  return result;
}

/**
 * Write back every run that has stopped, and say how many.
 *
 * A run ends without telling anybody: the session closes its step and goes
 * away, or it dies and nothing at all happens. So the rows are read against
 * the steps they were sent at and against what has been pushed since they were
 * fired -- `lib/plan/liveness.ts` holds those rules -- and the ones that are
 * over are written back here, with what was last seen of them.
 *
 * The pushes are handed in rather than read here, because #563 settled that
 * nothing on the plan page's own render waits on GitHub: the page sweeps on
 * the clock as it always did, and the route that reads GitHub passes what it
 * read. No pushes means no evidence, which is the fallback #570 chose -- a run
 * past the two-hour mark is ended on the clock exactly as before. With them, a
 * run that is still pushing is left alone however long it has been going,
 * which is the thing the clock alone could not do.
 *
 * Run from the plan page, which is where the answer is read. A failed sweep is
 * logged and swallowed for the same reason the insert above is: a page that
 * cannot tidy the record is still a page worth reading.
 */
export async function endQuietRuns(input: {
  supabase: Db;
  userId: string;
  now?: number;
  /** What has been pushed since these runs started, when somebody has read it. */
  pushes?: readonly Push[] | null;
  /**
   * The instant the listing starts from. A run started before it is judged on
   * the clock: the listing cannot see its early pushes, and an empty slice of
   * it is not evidence that the run pushed nothing.
   */
  pushesSince?: number;
}): Promise<{ finished: number; failed: number; error: string | null }> {
  const now = input.now ?? Date.now();
  const nothing = { finished: 0, failed: 0 };

  const { data: rows, error } = await input.supabase
    .from('plan_runs')
    .select('id, plan_item_id, created_at')
    .eq('user_id', input.userId)
    .eq('status', 'started');
  if (error) {
    console.error(`plan_runs could not be read to end quiet runs: ${error.message}`);
    return { ...nothing, error: error.message };
  }

  const started = (rows ?? []) as Array<{
    id: string;
    plan_item_id: string | null;
    created_at: string;
  }>;
  if (started.length === 0) return { ...nothing, error: null };

  // Only the steps these runs name, and only the two columns that say one is
  // over: it closed, or it stopped to ask a question. #679.
  const stepIds = [...new Set(started.map((row) => row.plan_item_id).filter(Boolean))] as string[];
  type StepStamps = { completedAt: string | null; blockedAt: string | null };
  const stamps = new Map<string, StepStamps>();
  if (stepIds.length > 0) {
    const { data: steps } = await input.supabase
      .from('plan_items')
      .select('id, completed_at, blocked_at')
      .in('id', stepIds);
    for (const step of (steps ?? []) as Array<{
      id: string;
      completed_at: string | null;
      blocked_at: string | null;
    }>) {
      stamps.set(step.id, { completedAt: step.completed_at, blockedAt: step.blocked_at });
    }
  }

  const pushes = input.pushes ?? null;
  const finished: string[] = [];
  const ended: Array<{ id: string; note: string }> = [];
  for (const row of started) {
    const step = (row.plan_item_id ? stamps.get(row.plan_item_id) : null) ?? {
      completedAt: null,
      blockedAt: null,
    };
    const listed =
      input.pushesSince === undefined || new Date(row.created_at).getTime() >= input.pushesSince;
    if (!pushes || !listed) {
      const end = runEnd({ status: 'started', createdAt: row.created_at }, step, now);
      if (end === 'finished') finished.push(row.id);
      if (end === 'failed') ended.push({ id: row.id, note: runQuietNote(row.created_at, now) });
      continue;
    }

    const evidence: RunEvidence = {
      startedAt: row.created_at,
      lastPush: lastPushSince(pushes, row.created_at),
      stepClosedAt: step.completedAt,
      stepBlockedAt: step.blockedAt,
      read: true,
    };
    const liveness = runLiveness(evidence, now);
    if (liveness === 'finished') finished.push(row.id);
    if (liveness === 'ended') ended.push({ id: row.id, note: runEndedNote(evidence, now) });
  }

  if (finished.length > 0) {
    await input.supabase.from('plan_runs').update({ status: 'finished' }).in('id', finished);
  }
  // One at a time, because each reason names what was last seen of that run.
  for (const row of ended) {
    await input.supabase
      .from('plan_runs')
      .update({ status: 'failed', error: row.note })
      .eq('id', row.id);
  }

  return { finished: finished.length, failed: ended.length, error: null };
}

/**
 * Write off whatever is still running against a step, because it is being
 * replaced.
 *
 * `endQuietRuns` above is the same write on a clock: a run nothing has been
 * heard from for two hours is over whether or not anybody noticed. This is the
 * other way a run ends -- you looked at it, saw it had gone quiet, and handed
 * its step to a fresh session. Left alone, the row would go on reading
 * `started` for the rest of those two hours, the page would draw the new
 * session's claim over it, and `claimLiveness` would answer off the older of
 * the two runs.
 *
 * Every started run on the step rather than one named row, because there is no
 * sense in which one of two runs against the same step is the one being
 * replaced -- the step is being taken off all of them.
 *
 * A failure here is logged and not raised. The send it belongs to is the thing
 * that matters, and refusing to hand a step over because the record of the run
 * it replaces could not be tidied would be the tail wagging the dog.
 */
export async function endRunsOnStep(input: {
  supabase: Db;
  userId: string;
  stepId: string;
  /** Why it ended, as `lastRunLine` will read it back. */
  note: string;
}): Promise<void> {
  const { error } = await input.supabase
    .from('plan_runs')
    .update({ status: 'failed', error: input.note })
    .eq('user_id', input.userId)
    .eq('plan_item_id', input.stepId)
    .eq('status', 'started');
  if (error) {
    console.error(`plan_runs could not be ended for a replaced run: ${error.message}`);
  }
}

/** What the run behind one claimed step is doing. */
export type StepRunReading = {
  runId: string;
  /** When the run was fired. */
  startedAt: string;
  /** The newest push on any branch since then, or null when there has been none. */
  lastPush: Push | null;
  liveness: RunLiveness;
  /** The run is over and never closed the step it was sent at. */
  abandoned: boolean;
};

/**
 * What is actually happening on every step that says it is being worked, by
 * step id.
 *
 * This is the question the plan page, the CLI and the send guard have all been
 * answering from `in_progress` and a clock. One read of the claimed steps, one
 * read of the runs sent at them, and one listing of what has been pushed since
 * the oldest of those runs started -- three requests whatever the number of
 * steps.
 *
 * A claimed step with no run recorded gets no reading at all: it was claimed by
 * a person or by `plan.ts start` rather than by a button, and nothing was ever
 * fired to ask about. Whoever is reading falls back to the clock for those, the
 * same as before.
 *
 * The listing comes back with the readings so that whoever asked can hand it
 * to `endQuietRuns` and have the runs written back from the same evidence,
 * rather than reading GitHub twice to say the same thing.
 *
 * Nothing is written here. Storing the answer is #568 and calling this from the
 * page is #569; this is the part that knows how to find out.
 */
export async function readRunLiveness(input: {
  supabase: Db;
  userId: string;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<{
  steps: Record<string, StepRunReading>;
  pushes: Push[];
  /** Where the listing starts, or null when none was taken. */
  since: number | null;
  error: string | null;
}> {
  const now = input.now ?? Date.now();

  const { data: claimed, error: stepsError } = await input.supabase
    .from('plan_items')
    .select('id, status, completed_at')
    .eq('user_id', input.userId)
    .eq('status', 'in_progress');
  if (stepsError) return { steps: {}, pushes: [], since: null, error: stepsError.message };

  const steps = (claimed ?? []) as Array<{
    id: string;
    status: string;
    completed_at: string | null;
  }>;
  if (steps.length === 0) return { steps: {}, pushes: [], since: null, error: null };

  const { data: runRows, error: runsError } = await input.supabase
    .from('plan_runs')
    .select('id, plan_item_id, created_at')
    .eq('user_id', input.userId)
    .in(
      'plan_item_id',
      steps.map((step) => step.id),
    )
    .order('created_at', { ascending: false });
  if (runsError) return { steps: {}, pushes: [], since: null, error: runsError.message };

  // Newest first, so the first row seen for a step is the run that holds it.
  const latest = new Map<string, { id: string; created_at: string }>();
  for (const row of (runRows ?? []) as Array<{
    id: string;
    plan_item_id: string;
    created_at: string;
  }>) {
    if (!latest.has(row.plan_item_id)) latest.set(row.plan_item_id, row);
  }
  if (latest.size === 0) return { steps: {}, pushes: [], since: null, error: null };

  const oldest = Math.min(...[...latest.values()].map((run) => new Date(run.created_at).getTime()));
  const { pushes, error: pushError } = await listPushes({ since: oldest, fetch: input.fetch });

  const readings: Record<string, StepRunReading> = {};
  for (const step of steps) {
    const run = latest.get(step.id);
    if (!run) continue;
    const evidence: RunEvidence = {
      startedAt: run.created_at,
      lastPush: pushError ? null : lastPushSince(pushes, run.created_at),
      stepClosedAt: step.completed_at,
      // Every step here is `in_progress`, and the trigger clears `blocked_at`
      // the moment a row stops being blocked, so a claimed step never carries
      // one. A block under it is the sweep's question, not this one's.
      stepBlockedAt: null,
      read: !pushError,
    };
    const liveness = runLiveness(evidence, now);
    readings[step.id] = {
      runId: run.id,
      startedAt: run.created_at,
      lastPush: evidence.lastPush,
      liveness,
      abandoned: abandonedClaim(step, liveness),
    };
  }

  return { steps: readings, pushes, since: oldest, error: pushError };
}

/**
 * Ask GitHub about the runs behind the claimed steps, write down the answer,
 * and hand it back.
 *
 * The one place that asks. #563 settled that the plan page draws with whatever
 * was last written down and calls this a moment later, rather than holding the
 * render open on a request to GitHub -- so the page is quick, and the terminal
 * tool, a session's brief and the send guard all read the reading this wrote
 * instead of each asking or falling back to the clock.
 *
 * Three requests and a write. `readRunLiveness` reads the claimed steps, the
 * runs sent at them and one listing of what has been pushed since the oldest
 * of those runs started; the listing says which branch moved and to what sha
 * and nothing about what the commit said, so the subjects are looked up
 * separately and are allowed to come back missing. Then the runs the listing
 * was about are written back, and the same listing is handed to `endQuietRuns`
 * -- which is the whole point of it coming back from the reader: a run that
 * pushed four minutes ago keeps its step however long it has been going, and
 * asking GitHub twice to say that would be two readings that could disagree.
 *
 * A refusal is written down too, in `github_error`. It is the only way the
 * wrong key becomes visible: without it every run reads as though it pushed
 * nothing, which is how a token missing a permission went unnoticed for days.
 * A refused reading carries no push (`readingFor`), nothing is swept on the
 * clock instead of on evidence, and `readingTrusted` sets the reading aside so
 * the two-hour clock in `elapsed.ts` answers until somebody fixes the key.
 *
 * Failures are carried back rather than thrown, the same as the rest of this
 * file: a page that could not refresh its readings is still a page worth
 * reading, and it goes on showing what it already had.
 */
export async function refreshRunReadings(input: {
  supabase: Db;
  userId: string;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<{
  /** The reading now stored against each claimed step's run, by step id. */
  readings: Record<string, StoredRunReading>;
  /** How many run rows were written. */
  written: number;
  /** Why GitHub refused, which is also what went into `github_error`. */
  error: string | null;
}> {
  const now = input.now ?? Date.now();
  const checkedAt = new Date(now).toISOString();

  const live = await readRunLiveness({
    supabase: input.supabase,
    userId: input.userId,
    now,
    fetch: input.fetch,
  });
  // No evidence, so the sweep falls back to the clock exactly as the page's own
  // call does. #570: nothing repeats a reading nobody could take.
  //
  // No listing is no evidence either. With nothing claimed through a button
  // there is no listing, and on 24 September an empty one handed to the sweep
  // wrote off the #922 and #936 sessions as having pushed nothing while both
  // were merging to main, which freed their modules to the overnight runner.
  const pushes = live.error || live.since === null ? null : live.pushes;
  const pushesSince = live.since ?? undefined;

  const claimed = Object.entries(live.steps);
  if (claimed.length === 0) {
    // Nothing claimed has a run to ask about. The sweep still runs: a run whose
    // step closed is finished whatever is claimed now.
    await endQuietRuns({
      supabase: input.supabase,
      userId: input.userId,
      now,
      pushes,
      pushesSince,
    });
    return { readings: {}, written: 0, error: live.error };
  }

  const subjects = live.error
    ? {}
    : await commitSubjects({
        shas: claimed.map(([, reading]) => reading.lastPush?.sha ?? '').filter(Boolean),
        fetch: input.fetch,
      });

  const readings: Record<string, StoredRunReading> = {};
  // One update per distinct set of columns rather than one per run, which is
  // one update in the case that matters: a refusal reads the same for every
  // run, and so does silence.
  const groups = new Map<string, { columns: RunReadingColumns; ids: string[] }>();
  for (const [stepId, reading] of claimed) {
    const stored = readingFor({
      checkedAt,
      lastPush: reading.lastPush
        ? {
            at: reading.lastPush.at,
            sha: reading.lastPush.sha,
            subject: subjects[reading.lastPush.sha] ?? null,
          }
        : null,
      refusal: live.error,
    });
    readings[stepId] = stored;

    const columns = readingColumns(stored);
    const key = JSON.stringify(columns);
    const group = groups.get(key);
    if (group) group.ids.push(reading.runId);
    else groups.set(key, { columns, ids: [reading.runId] });
  }

  let written = 0;
  for (const group of groups.values()) {
    const { error } = await input.supabase
      .from('plan_runs')
      .update(group.columns)
      .in('id', group.ids)
      .eq('user_id', input.userId);
    if (error) {
      console.error(`what GitHub said about a run could not be written: ${error.message}`);
      continue;
    }
    written += group.ids.length;
  }

  await endQuietRuns({ supabase: input.supabase, userId: input.userId, now, pushes, pushesSince });

  return { readings, written, error: live.error };
}

/**
 * Whether a re-shape is re-reading this feature right now.
 *
 * The guard behind the greyed-out buttons on the page. The page decides from
 * the runs it already loaded; a press arrives from whatever the browser had on
 * screen, which may be minutes old, so the same question is asked again here
 * against the row rather than trusted from the client.
 *
 * `isResolvingAnswers` is the one rule for it, shared with the page, so the
 * button and the action cannot come to different answers about the same run.
 */
export async function reshapeUnderway(
  supabase: Db,
  userId: string,
  featureId: string,
  now: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('status, created_at, job')
    .eq('user_id', userId)
    .eq('plan_item_id', featureId)
    .eq('job', 'reshape')
    .order('created_at', { ascending: false })
    .limit(1);
  // A guard that cannot read the table lets the press through. Refusing on a
  // failed read would make a database hiccup look like a permanent lock, and
  // the collision it protects against is rarer than that.
  if (error || !data || data.length === 0) return false;

  const row = data[0] as { status: string; created_at: string; job: string };
  return isResolvingAnswers(
    {
      status: row.status === 'finished' || row.status === 'failed' ? row.status : 'started',
      createdAt: row.created_at,
      job: 'reshape',
    },
    now,
  );
}

/**
 * The last run against each step, by step id.
 *
 * One read of the account's runs rather than one per row: there are tens of
 * them, and the plan page wants the newest against every step it draws.
 */
export async function loadLastRuns(supabase: Db, userId: string): Promise<Record<string, LastRun>> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select(
      'plan_item_id, status, error, created_at, job, github_checked_at, last_push_at, last_push_sha, last_push_subject, github_error',
    )
    .eq('user_id', userId)
    .not('plan_item_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`plan_runs could not be read for the plan page: ${error.message}`);
    return {};
  }

  const last: Record<string, LastRun> = {};
  for (const row of (data ?? []) as Array<
    {
      plan_item_id: string;
      status: string;
      error: string | null;
      created_at: string;
      job: string;
    } & Partial<RunReadingColumns>
  >) {
    if (last[row.plan_item_id]) continue;
    last[row.plan_item_id] = {
      status: row.status === 'finished' || row.status === 'failed' ? row.status : 'started',
      createdAt: row.created_at,
      error: row.error,
      job: row.job as RunJob,
      reading: storedReading(row),
    };
  }
  return last;
}

/**
 * The raises sessions have filed against a step, newest first.
 *
 * Here rather than with the rest of the raises queue because the question is
 * about runs: a raise is one of the three things a run leaves behind, and the
 * plan page shows it beside what that run pushed and closed. `lib/raised/load.ts`
 * loads the queue itself -- every column and the thread under each row -- which
 * is far more than naming what a run raised needs.
 *
 * Only the rows that name a step at all, since a raise with no source cannot be
 * attributed to a run. Which step each one names is
 * `sourceNumbers` in `lib/plan/work.ts`, so the matching rule is pure and the
 * query stays one read.
 */
export async function loadRunRaises(supabase: Db, userId: string): Promise<RunRaise[]> {
  const { data, error } = await supabase
    .from('raised_items')
    .select('id, title, source, created_at')
    .eq('user_id', userId)
    .not('source', 'is', null)
    .order('created_at', { ascending: false })
    .limit(RUN_RAISE_LIMIT);
  if (error) {
    console.error(`raised_items could not be read for the plan page: ${error.message}`);
    return [];
  }

  return (
    (data ?? []) as Array<{
      id: string;
      title: string;
      source: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * How many of an account's feature runs are read back to find a night's.
 *
 * The window is applied here rather than in the query, the way the tick's own
 * `lastFeatureFires` does it: there are tens of these rows per account and a
 * night's are all at the top of them. Two hundred is several months of
 * pressing the button by hand.
 */
const FIRE_LIMIT = 200;

/** One press the runner made, as `nightFrom` reads it. */
export type FeatureFire = { planItemId: string | null; at: string };

/**
 * Every feature the runner may have fired, newest first.
 *
 * `status` and `error` are deliberately not read. `endQuietRuns` is the only
 * thing that ever writes a run back and it runs from the plan page's render,
 * so at four in the morning every run of the night still says `started` with
 * no error on it. Anything counting finished against failed off that column
 * would say the night finished nothing, every time. What each feature's
 * session achieved is read from the steps that closed under it instead, which
 * is how the tick itself judges a run -- see `lib/digest/night.ts`.
 *
 * Here rather than in the cron that wrote it first, because since #633 the
 * plan page reads the same rows to say what the night is doing: the morning
 * report and the live card must be looking at one set of fires, or they will
 * disagree about how many features a night got through.
 */
export async function loadFeatureFires(supabase: Db, userId: string): Promise<FeatureFire[]> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('plan_item_id, created_at')
    .eq('user_id', userId)
    .eq('job', 'feature')
    .order('created_at', { ascending: false })
    .limit(FIRE_LIMIT);
  if (error) {
    console.error(`plan_runs could not be read for the night: ${error.message}`);
    return [];
  }
  return ((data ?? []) as Array<{ plan_item_id: string | null; created_at: string }>).map(
    (row) => ({ planItemId: row.plan_item_id, at: row.created_at }),
  );
}

/** A run still going, as the plan page's "On" lines read it. */
export type StartedRun = { planItemId: string; at: string };

/**
 * Every run still going that was sent at a row, newest first (note 39576272).
 *
 * Read on the plan page after `endQuietRuns` has written back the ones that
 * are over, so `started` here means going now. Any job, not only feature
 * fires: a re-shape or a step run fired by hand beside the night's session is
 * a session running in parallel all the same.
 */
export async function loadStartedRuns(supabase: Db, userId: string): Promise<StartedRun[]> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('plan_item_id, created_at')
    .eq('user_id', userId)
    .eq('status', 'started')
    .not('plan_item_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(FIRE_LIMIT);
  if (error) {
    console.error(`plan_runs could not be read for the runs going now: ${error.message}`);
    return [];
  }
  return ((data ?? []) as Array<{ plan_item_id: string; created_at: string }>).map((row) => ({
    planItemId: row.plan_item_id,
    at: row.created_at,
  }));
}
