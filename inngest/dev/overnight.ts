import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseStaleClaims } from '@/inngest/dev/claims';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { listPushes, refreshMainCheck } from '@/lib/plan/ci';
import { handFeatureToClaude } from '@/lib/plan/handover';
import type { CheckConclusion } from '@/lib/plan/checks';
import {
  featureRunIdle,
  lastPushSince,
  runLiveness,
  type Push,
  type RunLiveness,
} from '@/lib/plan/liveness';
import { loadPlan } from '@/lib/plan/load';
import {
  loadOvernightRun,
  OVERNIGHT_AT_ONCE,
  overnightVerdict,
  recordOvernightFire,
  stopOvernightRun,
  type OvernightRun,
} from '@/lib/plan/overnight';
import { chooseOvernightFeature, OVERNIGHT_NOTHING_READY } from '@/lib/plan/overnight-choice';
import { endsRun } from '@/lib/plan/run-end';
import { subtreeBlockedAt, subtreeClosedAt, subtreeTrail } from '@/lib/plan/subtree';
import { buildPlanTree, flatten, type PlanNode, type PlanSection } from '@/lib/plan/tree';

/**
 * One tick of the overnight runner: fire a feature, or leave everything alone.
 *
 * The clock calls this every few minutes all night. Most calls do nothing: the
 * runner keeps up to `OVERNIGHT_AT_ONCE` feature sessions going, each in a
 * different module, and starts at most one a tick. So the ordinary answer is
 * "every slot is taken" and the answer that costs anything happens a handful
 * of times a night.
 *
 * Three questions, in the order that makes the cheapest refusal first. The
 * row -- is the runner on, is the budget gone, is the clock gone, is it held
 * -- is `overnightVerdict` and needs no reads at all. The sessions -- which of
 * them are still going -- is `runLiveness` for each and costs one listing of
 * what has been pushed. The plan -- what should go next -- is
 * `chooseOvernightFeature` over the features outside the running ones'
 * modules, and costs the whole tree. Only the last one can fire. The stale-claim sweep runs
 * ahead of both of those reads, so a claim whose session has ended comes back
 * on a tick that ends up waiting as well as on the tick that fires.
 *
 * The one place this departs from "check liveness first" is a night that is
 * already over on its own terms. A budget that is spent or a stop time that
 * has passed ends the night whether or not the last session is still typing:
 * ending means "fire nothing more", not "stop what is running", and a night
 * held open waiting for a session that GitHub cannot be asked about would sit
 * there `running` until morning with nothing written on it -- which is exactly
 * the state the morning report has nothing to say about. Firing is what the
 * liveness check guards, and firing is still behind it.
 *
 * The third question can be asked more than once in a tick. The send has
 * refusals of its own -- a proposal, a re-shape underway, a claim still live
 * beneath the feature -- and a refused feature is treated exactly like one
 * whose last run closed nothing: pruned out of the tree, and the chooser asked
 * again. Only when nothing ready is left does the night end, naming what
 * refused and why.
 */

/** How many accounts one tick will look at. There is one row per account. */
const ACCOUNT_LIMIT = 100;

/**
 * How far before `last_fired_at` a run row may have been written and still be
 * the run that fire started.
 *
 * The row is inserted a moment before the fire is recorded, so it is normally
 * a second older. Anything older than this is a different run, which means the
 * insert for the last fire never landed -- and a tick that took an older run's
 * silence as evidence would start a second session on top of a live one.
 */
const FIRE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Every ready feature had already been tried, and none of them got anywhere.
 *
 * A sentence, like every other `ended_reason`, because the morning report
 * prints it verbatim. It is a different fact from `OVERNIGHT_NOTHING_READY`:
 * there was work handed over and ready, and the runner declined to fire it
 * again because the last run against it closed nothing. Saying "nothing was
 * ready" there would be the plan describing itself wrongly.
 */
export const OVERNIGHT_NO_PROGRESS =
  'Every feature left had already been tried without a single step closing, so it ' +
  'stopped rather than firing them again.';

/** A feature the send would not take, and the sentence it said no with. */
export type RefusedFeature = { number: number; error: string };

/** One refusal as the ending reason prints it, made to stand on its own. */
function sayRefusal(refusal: RefusedFeature): string {
  const said = refusal.error.trim();
  const stopped = /[.!?]$/.test(said) ? said : `${said}.`;
  // Most of the send's refusals open with the feature's own number, and
  // repeating it would read as a stutter. The two that do not -- the feature
  // has gone, and nothing open is left under it -- get it put in front.
  return stopped.startsWith(`#${refusal.number}`) ? stopped : `#${refusal.number}: ${stopped}`;
}

/**
 * The night ran out of features the send would take.
 *
 * A sentence, like every other `ended_reason`, because the morning report and
 * the Overnight card print it verbatim -- so the refusals themselves are in
 * it. "It stopped early" with no names is the version of this the person can
 * do nothing about at breakfast; "#640 is only a proposal, #651 is being
 * re-read" is a morning's work listed out.
 *
 * `ranOutBecause` is what the chooser said when the pruned tree came back
 * empty, and the two cases read differently: a night where every candidate
 * refused is a different fact from one that had also passed features over for
 * closing nothing last time, and a reason that claimed the first when the
 * second happened would be the plan describing itself wrongly again.
 */
export function overnightRefusedReason(
  refused: readonly RefusedFeature[],
  ranOutBecause: string,
): string {
  const lead =
    ranOutBecause === OVERNIGHT_NO_PROGRESS
      ? 'Nothing left could be started: what had not already been tried without a step ' +
        'closing refused the send.'
      : 'Every feature left refused the send, so it stopped rather than retrying them.';
  return `${lead} ${refused.map(sayRefusal).join(' ')}`;
}

/**
 * Whether nothing under this feature has closed since the given instant.
 *
 * The zero-progress guard's rule. A feature whose last run closed no steps is
 * a feature whose remaining work is stuck on something a session cannot move:
 * fire it again and it costs a session, ten minutes and one off the budget to
 * reach the same wall. `completed_at` is what a closed step carries, and the
 * whole subtree is checked because the run was sent at the feature and could
 * have closed any step beneath it.
 *
 * No previous run means nothing to judge, so it is not held back.
 */
export function closedNothingSince(feature: PlanNode, since: string | null): boolean {
  if (!since) return false;
  const at = new Date(since).getTime();
  if (!Number.isFinite(at)) return false;
  return !flatten([feature]).some((node) => {
    const closed = node.completedAt ? new Date(node.completedAt).getTime() : null;
    return closed !== null && closed >= at;
  });
}

/** The same sections with one top-level feature taken out of them. */
function without(sections: readonly PlanSection[], featureId: string): PlanSection[] {
  return sections.map((section) => ({
    ...section,
    nodes: section.nodes.filter((node) => node.id !== featureId),
  }));
}

/**
 * The sections with every feature a running session could collide with taken
 * out: the running features themselves, and every other feature in one of
 * their modules.
 *
 * Module is the line because it is where the files are. Two sessions in the
 * same module edit the same pages, loaders and tests, and the second to merge
 * inherits a conflict it did not write. Across modules what they share is the
 * handful of common files (globals.css, components/ui, the test helpers), and
 * the merge gate is what catches a collision there.
 *
 * A feature with no module is its own group: two of them are not run at once.
 * A running feature the tree no longer shows, closed or dropped since it was
 * fired, names no module and holds back only itself.
 */
export function outsideRunning(
  sections: readonly PlanSection[],
  runningIds: readonly string[],
): PlanSection[] {
  const running = new Set(runningIds);
  const busyModules = new Set<string>();
  for (const section of sections) {
    for (const node of section.nodes) {
      if (running.has(node.id)) busyModules.add(node.module ?? '');
    }
  }
  return sections.map((section) => ({
    ...section,
    nodes: section.nodes.filter(
      (node) => !running.has(node.id) && !busyModules.has(node.module ?? ''),
    ),
  }));
}

/**
 * The feature to fire now, with the ones that got nowhere last time passed
 * over.
 *
 * `chooseOvernightFeature` names the feature above the most urgent ready step
 * and knows nothing about what happened last time it was fired. This wraps it
 * with the one thing the tick knows and it does not: which features have
 * already been sent a session that closed no steps. A passed-over feature is
 * taken out of the tree and the choice is made again, so the runner moves on
 * to the next feature rather than stalling on the first.
 *
 * Only the section listings are pruned, not the counts on them -- the chooser
 * reads the nodes and nothing else, and a tally that is one feature out never
 * leaves this function.
 *
 * When everything ready has been passed over the night ends, and it ends
 * saying so rather than borrowing "nothing was ready", which would not be
 * true.
 */
export function chooseOvernightFire(
  sections: readonly PlanSection[],
  run: OvernightRun | null,
  now: number,
  /** When each feature was last fired, by feature id. */
  lastFiredAt: Readonly<Record<string, string>>,
): ReturnType<typeof chooseOvernightFeature> {
  let remaining: readonly PlanSection[] = sections;
  let passedOver = false;

  // One pass per top-level feature at the outside; each turn either answers or
  // removes one.
  const rounds = sections.reduce((total, section) => total + section.nodes.length, 0) + 1;
  for (let round = 0; round < rounds; round += 1) {
    const choice = chooseOvernightFeature(remaining, run, now);
    if (choice.act !== 'fire') {
      if (passedOver && choice.act === 'end' && choice.reason === OVERNIGHT_NOTHING_READY) {
        return { act: 'end', reason: OVERNIGHT_NO_PROGRESS };
      }
      return choice;
    }
    if (!closedNothingSince(choice.feature, lastFiredAt[choice.feature.id] ?? null)) return choice;
    passedOver = true;
    remaining = without(remaining, choice.feature.id);
  }

  return { act: 'end', reason: OVERNIGHT_NO_PROGRESS };
}

/** What one tick did, which is usually nothing. */
export type OvernightTick =
  | { act: 'idle' }
  | { act: 'paused' }
  /**
   * Nothing was started or written: every slot is taken, or what is ready is
   * in the modules the running sessions are already in. `running` is how many
   * are going; `liveness` is `unknown` when any of them could not be read.
   */
  | { act: 'waiting'; liveness: RunLiveness; running: number }
  /**
   * Nothing was ready this minute, and the night was left running.
   *
   * Not an `ended`. "Ready" is a reading of the tree at one instant and three
   * ordinary things change it without anybody pushing: a stale claim is swept,
   * a step closes, the person approves a proposal. Ending on it spends the
   * rest of the night on a fact that was about to stop being true.
   *
   * It did, on 18 September. The night stopped at 23:44 saying nothing was
   * handed over and ready, with sixteen features of budget and 2h33m of clock
   * left. Steps #551 and #637 were both held by claims of sessions that had
   * died, and the sweep that put them back ran at 23:49 -- five minutes after
   * the night had given up. Waiting costs one read of the tree per tick.
   */
  | { act: 'nothing-ready'; reason: string }
  | { act: 'ended'; reason: string }
  | {
      act: 'fired';
      feature: number;
      step: number;
      featuresLeft: number | null;
      /** Features the send refused on the way here, in the order they were tried. */
      refused: number[];
      /** Sessions going now, this one included. */
      running: number;
    }
  /**
   * The send broke. The night is left running.
   *
   * Not a refusal: a feature the send will not take is passed over and the
   * next one tried, and only a failure that would repeat on every feature --
   * a write that errored, a routine that would not start -- lands here.
   */
  | { act: 'failed'; error: string };

/**
 * What a tick decided, as the sentence the page shows under the runner.
 *
 * Stored on the row (migration 0098) so the page says why the runner is
 * waiting instead of guessing from pushes. Null for a tick that has nothing
 * to say: an idle or held runner, where the row already says so.
 */
export function tickNote(tick: OvernightTick): string | null {
  switch (tick.act) {
    case 'waiting':
      if (tick.liveness === 'unknown') {
        return 'Waiting. GitHub could not be asked whether a session is still going, so nothing new is started until it can.';
      }
      if (tick.running >= OVERNIGHT_AT_ONCE) {
        return `Waiting: ${tick.running} sessions are running, the most it starts at once.`;
      }
      return tick.running === 1
        ? 'Waiting: one session is running, and nothing else is ready outside its module.'
        : `Waiting: ${tick.running} sessions are running, and nothing else is ready outside their modules.`;
    case 'nothing-ready':
      return `Waiting until something is ready. ${tick.reason}`;
    case 'fired':
      return tick.running > 1
        ? `Started #${tick.feature}. ${tick.running} sessions are running.`
        : `Started #${tick.feature}.`;
    case 'ended':
      return tick.reason;
    case 'failed':
      return `The last check could not finish: ${tick.error}`;
    default:
      return null;
  }
}

/**
 * Everything the tick needs from outside itself.
 *
 * Handed in rather than reached for, so the decision -- which is the whole of
 * what #581 is -- can be tested without a database, a plan or GitHub, the same
 * way `runIncrementalSync` is.
 */
export type OvernightPorts = {
  now: number;
  loadRun: () => Promise<OvernightRun | null>;
  loadSections: () => Promise<readonly PlanSection[]>;
  /** When each feature was last fired, by feature id. */
  lastFiredAt: () => Promise<Record<string, string>>;
  /**
   * The feature sessions still going, each with the feature it was sent at.
   * Sessions that have finished or ended are left out. A fire that left no
   * record comes back as one with no feature and an `unknown` reading.
   */
  runsInFlight: (run: OvernightRun) => Promise<InFlightRun[]>;
  /** Put back the claims of sessions that died. Run on every tick of a running night. */
  sweepClaims: () => Promise<void>;
  /**
   * Send the feature. `refused` says the feature itself cannot be taken --
   * a proposal, a re-shape rewriting it, a claim still live beneath it -- as
   * opposed to the send having broken, which is every feature's problem and
   * not this one's.
   */
  fire: (
    feature: PlanNode,
    step: PlanNode,
  ) => Promise<{ ok: boolean; error?: string; refused?: boolean }>;
  /** Take one off the budget, given what the row said was left. */
  recordFire: (featuresLeft: number | null) => Promise<void>;
  stop: (reason: string) => Promise<void>;
};

/** A feature session that is still going, as the tick counts it. */
export type InFlightRun = { featureId: string | null; liveness: RunLiveness };

/** A run that has stopped, so its slot is free. */
function isOver(liveness: RunLiveness | null): boolean {
  return liveness === null || liveness === 'ended' || liveness === 'finished';
}

/** The reading a waiting tick reports: `unknown` if any could not be read. */
function waitingOn(runs: readonly InFlightRun[]): RunLiveness {
  if (runs.some((one) => one.liveness === 'unknown')) return 'unknown';
  return runs[0]?.liveness ?? 'working';
}

/**
 * One account's tick.
 *
 * `unknown` counts as still going, deliberately. It means GitHub could not be
 * asked, and silence the app could not hear is not evidence that a session
 * stopped -- firing on it is how two sessions end up building the same feature
 * at once. An unknown session keeps its slot and its module. A fire that left
 * no record at all is worse, since nothing says which feature it was, so the
 * tick fires nothing while one is outstanding and the night ends on its own
 * stop time, which is the safe way round.
 */
export async function overnightTick(ports: OvernightPorts): Promise<OvernightTick> {
  const run = await ports.loadRun();
  const verdict = overnightVerdict(run, ports.now);
  if (verdict.act === 'idle') return { act: 'idle' };
  if (verdict.act === 'paused') return { act: 'paused' };
  if (verdict.act === 'end') {
    await ports.stop(verdict.reason);
    return { act: 'ended', reason: verdict.reason };
  }
  // `fire` is only ever reached with a running row, so there is one here.
  if (!run) return { act: 'idle' };

  // Before the liveness check, so a claim comes back on any tick of a running
  // night and not only on the pass that will choose from the tree.
  //
  // A session that died mid-feature left its step saying `in_progress`, and
  // nothing puts that back overnight: the sweep is a stage of the daily cron.
  // So the step is not ready, the send guard refuses the feature above it, and
  // one dead run holds up the rest of the night. Sweeping means the claim goes
  // back within one tick of ageing out, and the tree read further down sees the
  // step as the not-started work it is.
  //
  // This used to sit under the liveness check, on the reasoning that a tick
  // which will not fire has no use for a freed claim. The claims that go stale
  // are mostly not the one the night is waiting on; they belong to other
  // sessions under other features, and they age out during the hours the night
  // spends waiting. Held until the next firing tick, they come back that much
  // later. The sweep is one indexed read of the in-progress rows and finds
  // nothing on the ordinary tick, so running it every tick of a running night
  // costs about what skipping it saved.
  //
  // Nothing is swept when the runner is off, paused or ending: those ticks
  // write nothing at all.
  //
  // A sweep that fails is logged and stepped over rather than thrown. It is a
  // tidying pass, not a precondition: without it the tick chooses from the tree
  // as it stands, which is what every night did before this, and a night that
  // gave up on one unreadable table would cost itself every feature it could
  // still have fired.
  try {
    await ports.sweepClaims();
  } catch (err) {
    console.error(
      `stale claims could not be swept on the overnight tick: ${
        err instanceof Error ? err.message : 'failed'
      }`,
    );
  }

  const inFlight = (await ports.runsInFlight(run)).filter((one) => !isOver(one.liveness));
  const unrecorded = inFlight.some((one) => one.featureId === null);
  if (inFlight.length >= OVERNIGHT_AT_ONCE || unrecorded) {
    return { act: 'waiting', liveness: waitingOn(inFlight), running: inFlight.length };
  }
  const runningIds = inFlight.map((one) => one.featureId as string);

  const [allFires, sections] = await Promise.all([ports.lastFiredAt(), ports.loadSections()]);

  // Only the fires this run made. The guard below passes over a feature whose
  // last session closed nothing, and that is the right rule inside one run: it
  // stops the runner spending the night offering the same stuck feature every
  // four minutes.
  //
  // Read over all time it is a different rule and a much worse one. One
  // session that died without closing anything takes its feature out of every
  // night that follows, for good, with nothing on the page to say why. #532
  // has been excluded since 18 September by a session that never got as far as
  // claiming its step, and it is still handed to Claude and still ready.
  const since = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const lastFiredAt: Record<string, string> =
    since === null
      ? allFires
      : Object.fromEntries(
          Object.entries(allFires).filter(([, at]) => new Date(at).getTime() >= since),
        );

  // A refused feature is the same case as one whose last run closed nothing:
  // take it out of the tree and ask again.
  //
  // The send says no for several reasons -- a step beneath it is claimed, a
  // re-shape is rewriting it, it is only a proposal -- and every one of them
  // is a fact about that feature that will still be true on the next tick. The
  // tick used to treat a refusal as the end of its turn, so it spent the night
  // offering the same feature every four minutes while five others sat ready.
  //
  // The retry has to happen here rather than inside `chooseOvernightFire`,
  // which is pure: whether a feature refuses is only knowable by asking the
  // send, which writes. So the choosing and the firing take turns, each
  // refusal costs one candidate, and the loop can go round at most once per
  // top-level feature.
  const refused: RefusedFeature[] = [];
  let remaining: readonly PlanSection[] = outsideRunning(sections, runningIds);
  const rounds = remaining.reduce((total, section) => total + section.nodes.length, 0) + 1;

  for (let round = 0; round < rounds; round += 1) {
    const choice = chooseOvernightFire(remaining, run, ports.now, lastFiredAt);
    if (choice.act === 'end') {
      // The chooser can only say the tree ran out, and once anything has been
      // refused that is no longer the whole truth: the reason has to name them,
      // because the row's sentence is all the morning gets.
      const reason =
        refused.length > 0 ? overnightRefusedReason(refused, choice.reason) : choice.reason;
      // Nothing ready is a reading of one instant, so the night keeps its
      // clock and asks again in four minutes. The budget and the stop time are
      // settled and do end it; this is not.
      //
      // Refusals are the same reading. A feature refuses the send because a
      // re-shape is rewriting it, because a claim beneath it is still live, or
      // because it is only a proposal -- and the first two clear themselves
      // while nobody is watching. On 19 September a run with no limit ended
      // twenty-one minutes in: #669 and #656 both refused for a re-shape that
      // had been sitting in `started` for nearly two hours, and five other
      // features were waiting behind that.
      //
      // Retrying them costs a few queries a tick. The send refuses before it
      // starts a routine, so no session is fired and no tokens are spent, and
      // that is a much smaller price than a night that stops.
      // The same goes for every feature having been tried without a close. It
      // is a fact about this run so far, not about the plan: a claim frees, a
      // step closes under a neighbouring feature, you approve something, and
      // the tree reads differently four minutes later.
      //
      // Which leaves the budget and the stop time as the only two things that
      // end a run, and that is the whole rule. A run told to go until you stop
      // it has neither, so it goes until you stop it.
      if (choice.reason === OVERNIGHT_NOTHING_READY || choice.reason === OVERNIGHT_NO_PROGRESS) {
        // With sessions going, what is ready may only be in their modules, and
        // one of them finishing changes that. Said as waiting on them.
        if (inFlight.length > 0 && refused.length === 0) {
          return { act: 'waiting', liveness: waitingOn(inFlight), running: inFlight.length };
        }
        return { act: 'nothing-ready', reason };
      }
      await ports.stop(reason);
      return { act: 'ended', reason };
    }
    if (choice.act !== 'fire') return { act: choice.act };

    const sent = await ports.fire(choice.feature, choice.step);
    if (sent.ok) {
      // Only after something was actually started. A budget that went down on a
      // send that never happened is a night that spends itself on nothing.
      await ports.recordFire(run.featuresLeft);
      return {
        act: 'fired',
        feature: choice.feature.number,
        step: choice.step.number,
        featuresLeft: run.featuresLeft === null ? null : Math.max(0, run.featuresLeft - 1),
        refused: refused.map((one) => one.number),
        running: inFlight.length + 1,
      };
    }

    const error = sent.error ?? 'The feature could not be sent.';
    // A send that broke rather than refused stops the tick where it stands.
    // The next feature would be handed to the same routine over the same
    // connection and fail the same way, and a tick that worked down the whole
    // tree on a dead API would burn every candidate the night had left.
    if (!sent.refused) return { act: 'failed', error };

    refused.push({ number: choice.feature.number, error });
    remaining = without(remaining, choice.feature.id);
  }

  // Unreachable: every turn of the loop either answers or removes one of the
  // features it was bounded by. Here so the night ends on a sentence rather
  // than on a type error if that ever stops being true.
  /* v8 ignore next 3 */
  const reason = overnightRefusedReason(refused, OVERNIGHT_NOTHING_READY);
  await ports.stop(reason);
  return { act: 'ended', reason };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * When each feature was last sent a session, by feature id.
 *
 * One read of the account's feature runs rather than one per candidate: there
 * are tens of them and the tick may pass over several features before it finds
 * one worth firing. Newest first, so the first row seen for a feature is its
 * last run.
 */
async function lastFeatureFires(supabase: Db, userId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('plan_item_id, created_at')
    .eq('user_id', userId)
    .eq('job', 'feature')
    .not('plan_item_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`plan_runs could not be read for the overnight tick: ${error.message}`);
    return {};
  }

  const last: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ plan_item_id: string; created_at: string }>) {
    if (!last[row.plan_item_id]) last[row.plan_item_id] = row.created_at;
  }
  return last;
}

/**
 * How far back a feature run marked started is still read as possibly going.
 *
 * Nothing sweeps plan_runs rows while nobody has the plan page open, so rows
 * from sessions long over still say `started`. Each one read costs a few
 * queries, and `runLiveness` calls a run ended after two hours without a push,
 * so a run older than this is not worth the reads.
 */
const IN_FLIGHT_LOOKBACK_MS = 6 * 60 * 60 * 1000;

type FeatureRunRow = { plan_item_id: string | null; status: string; created_at: string };

/**
 * The feature sessions still going, whoever fired them.
 *
 * Every feature run started in the last six hours is read, not only this
 * night's, because a feature sent by hand is a session in a module like any
 * other and counts against the three. A row already written back as finished
 * or failed is over and costs nothing further; one still marked started is
 * judged from its own rows and from what has been pushed since it began, by
 * the same `runLiveness` the plan page uses.
 *
 * A newest run older than the fire the night records means the run that was
 * fired left no record -- `startRoutineRun` logs a failed insert and carries
 * on -- and that comes back as a session with no feature and an `unknown`
 * reading: something was started and the app cannot see it.
 */
export async function featureRunsInFlight(input: {
  supabase: Db;
  userId: string;
  run: OvernightRun;
  now: number;
  fetch?: typeof globalThis.fetch;
}): Promise<InFlightRun[]> {
  const { supabase, userId, run, now } = input;
  const since = now - IN_FLIGHT_LOOKBACK_MS;

  const { data, error } = await supabase
    .from('plan_runs')
    .select('plan_item_id, status, created_at')
    .eq('user_id', userId)
    .eq('job', 'feature')
    .gte('created_at', new Date(since).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error(`plan_runs could not be read for the overnight tick: ${error.message}`);
    return [{ featureId: null, liveness: 'unknown' }];
  }
  const rows = (data ?? []) as FeatureRunRow[];

  const out: InFlightRun[] = [];
  const fired = run.lastFiredAt ? new Date(run.lastFiredAt).getTime() : null;
  // Only a fire recent enough for its row to be in this read can be missing
  // one. An older fire's row is outside the window whether or not it landed.
  if (fired !== null && fired - FIRE_WINDOW_MS >= since) {
    const newest = rows[0];
    if (!newest || new Date(newest.created_at).getTime() < fired - FIRE_WINDOW_MS) {
      out.push({ featureId: null, liveness: 'unknown' });
    }
  }

  const started = rows.filter((row) => row.status !== 'finished' && row.status !== 'failed');
  if (started.length === 0) return out;

  // One listing of pushes for all of them, from the oldest start: the listing
  // is the whole repository and each run takes the pushes after its own start.
  const oldest = Math.min(...started.map((row) => new Date(row.created_at).getTime()));
  const { pushes, error: pushError } = await listPushes({ since: oldest, fetch: input.fetch });

  const seen = new Set<string>();
  for (const row of started) {
    // Two runs at one feature: the newer one is the session that counts.
    if (row.plan_item_id) {
      if (seen.has(row.plan_item_id)) continue;
      seen.add(row.plan_item_id);
    }
    const liveness = await featureRunLiveness({
      supabase,
      userId,
      row,
      now,
      pushes: pushError ? null : pushes,
    });
    out.push({ featureId: row.plan_item_id, liveness });
  }
  return out;
}

/**
 * What one feature run still marked started is doing.
 *
 * The whole subtree, not the feature row. A run is fired at a feature and a
 * feature closes only once every step beneath it closes, so a feature with
 * one blocked or `proposed` step never closes and a test on the feature row
 * never fired -- which sent every run to the two-hour silence fallback,
 * however well it had gone. See 0089 for the nights that measured it.
 *
 * The newest block under the feature is read beside the newest close, and
 * `runLiveness` treats either as the end of the run. A session that stops to
 * ask a question closes nothing, so on the close alone it read as silence and
 * the tick waited out the no-output mark before firing again. #679.
 *
 * The feature's own rows come before the pushes. The push listing is the whole
 * repository, so another session pushing anywhere keeps this run reading as
 * alive, which matters more with three going at once; a run that has left its
 * own rows alone, with nothing claimed, is over whatever else is being pushed.
 * See `FEATURE_IDLE_AFTER_MINUTES`.
 */
export async function featureRunLiveness(input: {
  supabase: Db;
  userId: string;
  row: FeatureRunRow;
  now: number;
  /** Null when GitHub could not be read. */
  pushes: readonly Push[] | null;
}): Promise<RunLiveness> {
  const { supabase, userId, row } = input;
  let closedAt: string | null = null;
  let blockedAt: string | null = null;
  let trail: Awaited<ReturnType<typeof subtreeTrail>> = null;
  if (row.plan_item_id) {
    [closedAt, blockedAt, trail] = await Promise.all([
      subtreeClosedAt(supabase, row.plan_item_id),
      subtreeBlockedAt(supabase, row.plan_item_id),
      subtreeTrail(supabase, userId, row.plan_item_id),
    ]);
  }

  // A step claimed under the feature is a session at work in its module,
  // whatever closed before it. A run sent at a feature closes one step and
  // claims the next, and reading the first close as the end of the run freed
  // its slot and its module while it went on working: #749 on 23 September
  // closed #878 at 19:27, claimed #879 at 19:28, and the next tick offered
  // #749 again. A claim whose session died is put back by the stale-claim
  // sweep, which runs ahead of this on every tick.
  if (trail?.claimed) return 'working';

  // A close or block since the start is still `finished`, which says more.
  const endedOnRows = endsRun(closedAt, row.created_at) || endsRun(blockedAt, row.created_at);
  if (row.plan_item_id && !endedOnRows) {
    if (trail && featureRunIdle(row.created_at, trail, input.now)) return 'ended';
  }

  return runLiveness(
    {
      startedAt: row.created_at,
      lastPush: input.pushes ? lastPushSince(input.pushes, row.created_at) : null,
      stepClosedAt: closedAt,
      stepBlockedAt: blockedAt,
      read: input.pushes !== null,
    },
    input.now,
  );
}

/** The real reads and writes behind one account's tick. */
function portsFor(input: {
  supabase: Db;
  userId: string;
  now: number;
  fetch?: typeof globalThis.fetch;
}): OvernightPorts {
  const { supabase, userId, now } = input;
  let sections: readonly PlanSection[] | null = null;
  const loadSections = async (): Promise<readonly PlanSection[]> => {
    sections ??= buildPlanTree(await loadPlan(supabase, userId));
    return sections;
  };

  return {
    now,
    loadRun: () => loadOvernightRun(supabase, userId),
    loadSections,
    lastFiredAt: () => lastFeatureFires(supabase, userId),
    runsInFlight: (run) => featureRunsInFlight({ supabase, userId, run, now, fetch: input.fetch }),
    sweepClaims: async () => {
      // The same sweep the daily cron runs, and every account's claims at once
      // -- a claim nobody is working is wrong in the same way in every account,
      // which is why `releaseStaleClaims` takes no user. On an ordinary night
      // there is one account running anyway.
      //
      // A failure is left to `overnightTick`, which steps over it: the guard
      // belongs at the seam, where it is the decision's own property that a
      // tick which cannot sweep still fires, rather than a kindness this one
      // implementation happens to do.
      const swept = await releaseStaleClaims(supabase, new Date(now), { fetch: input.fetch });
      if (swept.released > 0) {
        console.log(
          `overnight: put back ${swept.released} stale claim(s): ${swept.steps.join(', ')}.`,
        );
      }
      if (swept.kept.length > 0) {
        console.log(`overnight: left ${swept.kept.join(', ')} alone, still pushing.`);
      }
    },
    fire: async (feature, step) => {
      // The same send the button makes, with the tree the choice was made from
      // rather than a second read of rows that cannot have moved since.
      const sent = await handFeatureToClaude({
        supabase,
        userId,
        id: feature.id,
        sections: await loadSections(),
        now,
      });
      // `refused` and not `ok: false` is the distinction the tick turns on:
      // one costs this feature, the other costs the tick.
      if (!sent.ok) return { ok: false, error: sent.error, refused: sent.refused === true };
      // The evidence for the choice, so a night can be read back later.
      console.log(
        `overnight: fired #${sent.number} "${sent.title}" for ready step #${step.number}.`,
      );
      return { ok: true };
    },
    recordFire: async (featuresLeft) => {
      const { error } = await recordOvernightFire({
        supabase,
        userId,
        featuresLeft,
        now: new Date(now),
      });
      if (error) console.error(`the overnight fire could not be recorded: ${error}`);
    },
    stop: async (reason) => {
      const { error } = await stopOvernightRun({ supabase, userId, reason, now: new Date(now) });
      if (error) console.error(`the overnight run could not be ended: ${error}`);
    },
  };
}

export type OvernightTickSummary = {
  /** Accounts with a night running when the tick looked. */
  accounts: number;
  /** Features started, which is at most one per account a tick. */
  fired: number;
  /** What happened to each, by user id, so the response says why nothing did. */
  results: Record<string, OvernightTick>;
  /**
   * What CI said about main's newest commit, read on this tick whether or not
   * anything was running. In the response so that a tick can be poked by hand
   * and the reading it took read back from what it answers.
   */
  main: {
    sha: string | null;
    conclusion: CheckConclusion | null;
    error: string | null;
    reason: string | null;
  };
};

/**
 * The cron's entry point: main's CI, then every account mid-run, one feature
 * at most each a tick.
 *
 * The CI reading comes first and happens on every tick, including the ones
 * where no night is running and this function used to do nothing at all. That
 * ordering is the point of #639 rather than a detail of it: main sat red from
 * 19:43 to 21:40 with two more merges landing on top of it, and nobody was
 * running a night, and nobody had /dev/plan open, so the app knew nothing and
 * said nothing. A red main matters most exactly when nobody is watching, so
 * the read cannot be behind the `running` filter -- and this tick is the only
 * thing in the app that runs every four minutes and holds GITHUB_READ_TOKEN.
 *
 * It costs two requests and one upsert. A tick with no night running was one
 * indexed select and is now one indexed select and that, which is still about
 * as cheap as a scheduled job gets, and it is what puts a dot on every page in
 * the app.
 *
 * Then the nights. Only the accounts with `running` set are read, which is
 * what `plan_overnight_runs_running_idx` is for -- on an ordinary night that is
 * one row or none.
 *
 * One account failing does not stop the next: the nights are independent and a
 * broken plan in one should not cost another its night.
 */
export async function runOvernightTick(
  input: {
    now?: number;
    supabase?: Db;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<OvernightTickSummary> {
  const supabase = input.supabase ?? createServiceSupabase();
  const now = input.now ?? Date.now();

  // Before anything is filtered on `running`, and stepped over if it breaks.
  // `refreshMainCheck` already carries its own refusals back as a stored row
  // rather than throwing, so only the write itself can land here -- and a tick
  // that could not store a dot still has nights to run.
  let main: OvernightTickSummary['main'] = {
    sha: null,
    conclusion: null,
    error: null,
    reason: null,
  };
  try {
    main = await refreshMainCheck({ supabase, now, fetch: input.fetch });
  } catch (err) {
    const said = err instanceof Error ? err.message : 'failed';
    console.error(`main's CI could not be read on this tick: ${said}`);
    main = { sha: null, conclusion: null, error: said, reason: null };
  }

  const { data, error } = await supabase
    .from('plan_overnight_runs')
    .select('user_id')
    .eq('running', true)
    .limit(ACCOUNT_LIMIT);
  if (error) throw new Error(error.message);

  const users = (data ?? []).map((row) => (row as { user_id: string }).user_id);
  const results: Record<string, OvernightTick> = {};
  let fired = 0;

  for (const userId of users) {
    try {
      const tick = await overnightTick(portsFor({ supabase, userId, now, fetch: input.fetch }));
      results[userId] = tick;
      if (tick.act === 'fired') fired += 1;
      await recordTick(supabase, userId, now, tickNote(tick));
      // A tick that fires says so; a tick that waits used to say nothing at
      // all, and the run that waited two hours for a session which had already
      // merged looked exactly like a quiet night. The reason is the whole
      // diagnosis, so it goes in the log beside the fires.
      if (tick.act === 'waiting') {
        console.log(`overnight: waiting -- the last run reads ${tick.liveness}.`);
      }
      if (tick.act === 'ended') console.log(`overnight: ended -- ${tick.reason}`);
      if (tick.act === 'nothing-ready') {
        console.log(`overnight: nothing ready this tick, still running -- ${tick.reason}`);
      }
    } catch (err) {
      const failed: OvernightTick = {
        act: 'failed',
        error: err instanceof Error ? err.message : 'failed',
      };
      results[userId] = failed;
      await recordTick(supabase, userId, now, tickNote(failed));
    }
  }

  return { accounts: users.length, fired, results, main };
}

/**
 * Write when the tick ran and what it decided onto the account's row.
 *
 * Logged and stepped over when it fails: the note is for the page, and a
 * night that could not write it still has features to fire.
 */
async function recordTick(
  supabase: Db,
  userId: string,
  now: number,
  note: string | null,
): Promise<void> {
  if (note === null) return;
  const { error } = await supabase
    .from('plan_overnight_runs')
    .update({ last_tick_at: new Date(now).toISOString(), last_tick_note: note.slice(0, 2000) })
    .eq('user_id', userId);
  if (error) console.error(`the tick's note could not be written: ${error.message}`);
}
