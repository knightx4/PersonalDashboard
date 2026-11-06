import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { fireFeatureRoutine, runIdFrom, type RoutineTarget } from '@/lib/feedback/routine';

/**
 * How fast the app wakes the broker (plan #2789.3, feature #2789).
 *
 * The broker's id and token sit on the deployment, so the measurement runs
 * there, behind /api/cron/broker-wake-test. A trial is a real session thread
 * (core.session_threads, titled "Wake test <run> #<n>") with one person
 * message; the app fires the broker's wake-up task with a text naming the
 * thread and asking the broker to do three things through the Dash connector:
 * read the thread, write a status line, and start a child session that writes
 * a text reply. Everything is timed from rows the sessions leave:
 *
 *   fired      the person message's created_at, written just before the fire.
 *   broker     the earlier of that message's delivered_at (read_thread marks
 *              it) and the first session status line: the broker's turn began.
 *   child      the first session text message: a session the broker started
 *              with create_session woke and reached the connector. Its
 *              arrival is also the proof that a child has the connector.
 *
 * A run is ten trials, one after another, so the broker is never asked two
 * things at once. One request cannot last that long, so each call to the
 * route advances the run by one step (fire the next trial when the last one
 * has replied or timed out) and returns the report so far. The trial threads
 * are the only record; no table was added.
 */

export const TRIAL_COUNT = 10;
/** A reply later than this is "over three minutes" in the step's terms. */
export const SLOW_MS = 3 * 60 * 1000;
/** A trial with no child reply this long after the fire is given up on. */
export const GIVE_UP_MS = 6 * 60 * 1000;

const TITLE = /^Wake test ([a-z0-9]{6}) #(\d{1,2})$/;
const FIRE_FAILED = 'fire failed: ';

export type ThreadRow = { id: string; title: string; state: string; created_at: string };
export type MessageRow = {
  thread_id: string;
  author: string;
  kind: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
};

export type TrialStatus = 'waiting' | 'replied' | 'timed_out' | 'fire_failed';

export type Trial = {
  n: number;
  threadId: string;
  firedAt: string;
  status: TrialStatus;
  /** Milliseconds from the fire to the broker's turn starting; null if it did not. */
  brokerMs: number | null;
  /** Milliseconds from the fire to the child's reply; null if none. */
  childMs: number | null;
  /** True when a child reply landed, false when the broker started a turn but no child ever wrote, null when unknown. */
  childHasConnector: boolean | null;
  error: string | null;
};

export type WakeReport = {
  run: string | null;
  fired: number;
  finished: boolean;
  trials: Trial[];
  brokerMedianMs: number | null;
  brokerWorstMs: number | null;
  childMedianMs: number | null;
  childWorstMs: number | null;
  timedOut: number;
  /** Every child that replied did so through the connector. */
  childrenHaveConnector: boolean | null;
  /** The numbers say the subscription broker is too slow or cannot be woken: write the fallback decision. */
  writeDecision: boolean;
  verdict: string;
};

const ms = (from: string, to: string | null): number | null => {
  if (!to) return null;
  const diff = Date.parse(to) - Date.parse(from);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The text the broker is woken with. It carries the whole test; the broker's
 * skill (#2789.6) leaves wake-test threads alone (lib/threads/broker-model.ts).
 */
export function wakeText(threadId: string, n: number): string {
  return [
    `Wake-up measurement ${n} of ${TRIAL_COUNT}. This is a timing test, not a message from the person. Do exactly these three things, in order, and nothing else.`,
    `1. With the Dash connector, call read_thread for thread_id ${threadId}.`,
    `2. Call reply_in_thread for thread_id ${threadId} with kind "status" and body "broker: turn started".`,
    `3. Start a new session on this repository with create_session. Its whole prompt is: Call the Dash connector's reply_in_thread with thread_id ${threadId}, kind "text" and body "child: connector loaded". If you have no Dash connector, say so in your final message instead. Then stop.`,
    'Do not wait for the child session and do not write anything else. Stop after step 3.',
  ].join('\n');
}

/** One trial's numbers from its thread and its messages. */
export function trialOf(
  thread: ThreadRow,
  messages: MessageRow[],
  now: number,
): Trial | null {
  const match = TITLE.exec(thread.title);
  if (!match) return null;
  const mine = messages
    .filter((m) => m.thread_id === thread.id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const person = mine.find((m) => m.author === 'person');
  if (!person) return null;
  const firedAt = person.created_at;

  const failure = mine.find((m) => m.author === 'session' && m.body.startsWith(FIRE_FAILED));
  const status = mine.find((m) => m.author === 'session' && m.kind === 'status' && !m.body.startsWith(FIRE_FAILED));
  const child = mine.find((m) => m.author === 'session' && m.kind === 'text');

  const starts = [ms(firedAt, person.delivered_at), status ? ms(firedAt, status.created_at) : null].filter(
    (v): v is number => v !== null,
  );
  const brokerMs = starts.length ? Math.min(...starts) : null;
  const childMs = child ? ms(firedAt, child.created_at) : null;

  let trialStatus: TrialStatus = 'waiting';
  if (failure) trialStatus = 'fire_failed';
  else if (child) trialStatus = 'replied';
  else if (now - Date.parse(firedAt) > GIVE_UP_MS) trialStatus = 'timed_out';

  return {
    n: Number(match[2]),
    threadId: thread.id,
    firedAt,
    status: trialStatus,
    brokerMs,
    childMs,
    childHasConnector: child ? true : trialStatus === 'timed_out' && brokerMs !== null ? false : null,
    error: failure ? failure.body.slice(FIRE_FAILED.length) : null,
  };
}

export function reportOf(run: string | null, trials: Trial[]): WakeReport {
  const sorted = [...trials].sort((a, b) => a.n - b.n);
  const failed = sorted.some((t) => t.status === 'fire_failed');
  const finished = failed || (sorted.length >= TRIAL_COUNT && sorted.every((t) => t.status !== 'waiting'));
  const broker = sorted.map((t) => t.brokerMs).filter((v): v is number => v !== null);
  const child = sorted.map((t) => t.childMs).filter((v): v is number => v !== null);
  const timedOut = sorted.filter((t) => t.status === 'timed_out').length;
  const connectorKnown = sorted.filter((t) => t.childHasConnector !== null);
  const childrenHaveConnector = connectorKnown.length ? connectorKnown.every((t) => t.childHasConnector === true) : null;
  const report: WakeReport = {
    run,
    fired: sorted.length,
    finished,
    trials: sorted,
    brokerMedianMs: median(broker),
    brokerWorstMs: broker.length ? Math.max(...broker) : null,
    childMedianMs: median(child),
    childWorstMs: child.length ? Math.max(...child) : null,
    timedOut,
    childrenHaveConnector,
    writeDecision: false,
    verdict: '',
  };
  report.writeDecision = finished && (failed || timedOut > 0 || (report.childWorstMs ?? 0) > SLOW_MS || child.length === 0);
  report.verdict = verdictOf(report, failed);
  return report;
}

function seconds(value: number | null): string {
  return value === null ? 'none' : `${Math.round(value / 1000)}s`;
}

function verdictOf(r: WakeReport, failed: boolean): string {
  if (!r.run) return 'No run yet.';
  if (!r.finished) return `Run ${r.run}: ${r.fired} of ${TRIAL_COUNT} fired, still going.`;
  const numbers = `Broker turn started: median ${seconds(r.brokerMedianMs)}, worst ${seconds(r.brokerWorstMs)}. Child reply landed: median ${seconds(r.childMedianMs)}, worst ${seconds(r.childWorstMs)}, ${r.timedOut} timed out. Children have the Dash connector: ${r.childrenHaveConnector === null ? 'unknown' : r.childrenHaveConnector ? 'yes' : 'no'}.`;
  if (failed) return `The wake-up task could not be fired. ${numbers} Write the fallback decision.`;
  return r.writeDecision
    ? `${numbers} A reply took over three minutes or never came: write the fallback decision.`
    : `${numbers} Within three minutes every time: keep the subscription broker.`;
}

type Deps = {
  client: SupabaseClient;
  core: SupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
  newRun?: () => string;
};

async function loadTrials(core: SupabaseClient, userId: string, now: number) {
  const { data: threads, error } = await core
    .from('session_threads')
    .select('id, title, state, created_at')
    .eq('user_id', userId)
    .like('title', 'Wake test %')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(`Reading the wake-test threads failed: ${error.message}`);
  const rows = ((threads ?? []) as ThreadRow[]).filter((t) => TITLE.test(t.title));
  const run = rows.length ? TITLE.exec(rows[0].title)![1] : null;
  const mine = rows.filter((t) => TITLE.exec(t.title)![1] === run);
  if (mine.length === 0) return { run, threads: mine, trials: [] as Trial[] };
  const { data: messages, error: messageError } = await core
    .from('session_messages')
    .select('thread_id, author, kind, body, created_at, delivered_at')
    .eq('user_id', userId)
    .in('thread_id', mine.map((t) => t.id));
  if (messageError) throw new Error(`Reading the wake-test messages failed: ${messageError.message}`);
  const trials = mine
    .map((t) => trialOf(t, (messages ?? []) as MessageRow[], now))
    .filter((t): t is Trial => t !== null);
  return { run, threads: mine, trials };
}

/** A finished run's threads are put away so they do not sit in Chat. */
async function endThreads(core: SupabaseClient, userId: string, threads: ThreadRow[]) {
  const open = threads.filter((t) => t.state !== 'ended').map((t) => t.id);
  if (open.length === 0) return;
  await core.from('session_threads').update({ state: 'ended' }).eq('user_id', userId).in('id', open);
}

/**
 * Advance the measurement one step and report where it stands.
 *
 * With no run, or the last one finished, `start` begins a new run; without it
 * a finished run is only reported. While a run is going, the next trial is
 * fired only once the one before has replied or timed out.
 */
export async function advanceWakeTest(deps: Deps & { start: boolean }): Promise<WakeReport & { fireNote: string | null }> {
  const { client, core, routine, now } = deps;
  const owner = await client.rpc('app_owner');
  const userId = (owner.data as { userId?: string } | null)?.userId;
  if (owner.error || !userId) throw new Error('Could not resolve the owner to measure for.');

  const missing = !routine.id ? 'CLAUDE_BROKER_ROUTINE_ID' : !routine.token ? 'CLAUDE_BROKER_ROUTINE_TOKEN' : null;

  let state = await loadTrials(core, userId, now);
  let report = reportOf(state.run, state.trials);
  const idle = state.trials.length === 0 || report.finished;
  if (report.finished) await endThreads(core, userId, state.threads);
  if (idle && !deps.start) return { ...report, fireNote: null };
  if (missing) throw new Error(`${missing} is not set on the deployment, so the broker cannot be woken.`);

  let run = state.run;
  let n = state.trials.length + 1;
  if (idle) {
    run = (deps.newRun ?? (() => Math.random().toString(36).slice(2, 8).padEnd(6, '0')))();
    n = 1;
  } else if (state.trials.some((t) => t.status === 'waiting')) {
    return { ...report, fireNote: null };
  }
  if (!run || n > TRIAL_COUNT) return { ...report, fireNote: null };

  const { data: thread, error } = await core
    .from('session_threads')
    .insert({ user_id: userId, title: `Wake test ${run} #${n}`, state: 'queued' })
    .select('id')
    .single();
  if (error || !thread) throw new Error(`Starting the trial thread failed: ${error?.message ?? 'no row'}`);
  const threadId = (thread as { id: string }).id;
  const text = wakeText(threadId, n);
  const { error: messageError } = await core
    .from('session_messages')
    .insert({ user_id: userId, thread_id: threadId, author: 'person', kind: 'text', body: text });
  if (messageError) throw new Error(`Writing the trial message failed: ${messageError.message}`);

  const fired = await fireFeatureRoutine({ apiKey: routine.token, routineId: routine.id, text, fetch: deps.fetch });
  let fireNote: string | null = null;
  if (fired.ok) {
    fireNote = `Fired trial ${n}${runIdFrom(fired.body) ? ` as session ${runIdFrom(fired.body)}` : ''}.`;
  } else {
    fireNote = `Trial ${n} could not be fired: ${fired.error}`;
    await core.from('session_messages').insert({
      user_id: userId,
      thread_id: threadId,
      author: 'session',
      kind: 'status',
      body: `${FIRE_FAILED}${fired.error}`.slice(0, 2000),
    });
  }

  state = await loadTrials(core, userId, Date.now());
  report = reportOf(state.run, state.trials);
  if (report.finished) await endThreads(core, userId, state.threads);
  return { ...report, fireNote };
}
