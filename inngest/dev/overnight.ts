import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseStaleClaims } from '@/inngest/dev/claims';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { listPushes, refreshMainCheck } from '@/lib/plan/ci';
import { handFeatureToClaude } from '@/lib/plan/handover';
import type { CheckConclusion } from '@/lib/plan/checks';
import { lastPushSince, runLiveness, type RunLiveness } from '@/lib/plan/liveness';
import { loadPlan } from '@/lib/plan/load';
import {
  loadOvernightRun,
  overnightVerdict,
  recordOvernightFire,
  stopOvernightRun,
  type OvernightRun,
} from '@/lib/plan/overnight';
import { chooseOvernightFeature, OVERNIGHT_NOTHING_READY } from '@/lib/plan/overnight-choice';
import { buildPlanTree, flatten, type PlanNode, type PlanSection } from '@/lib/plan/tree';

/**
 * One tick of the overnight runner: fire a feature, or leave everything alone.
 *
 * The clock calls this every few minutes all night. Almost every call does
 * nothing, and that is the shape of the thing: the runner starts one feature
 * and then waits for it, so the ordinary answer is "the last session is still
 * working" and the answer that costs anything happens a handful of times a
 * night.
 *
 * Three questions, in the order that makes the cheapest refusal first. The
 * row -- is the runner on, is the budget gone, is the clock gone, is it held
 * -- is `overnightVerdict` and needs no reads at all. The last session -- is
 * it still going -- is `runLiveness` and costs one listing of what has been
 * pushed. The plan -- what should go next -- is `chooseOvernightFeature` and
 * costs the whole tree. Only the last one can fire. The stale-claim sweep sits
 * between the second and the third, because it is the one write that has to
 * land before the tree is read rather than after.
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
  /** The last session is still going, so nothing was started or written. */
  | { act: 'waiting'; liveness: RunLiveness }
  | { act: 'ended'; reason: string }
  | {
      act: 'fired';
      feature: number;
      step: number;
      featuresLeft: number;
      /** Features the send refused on the way here, in the order they were tried. */
      refused: number[];
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
  /** What the run this night last fired is doing, or null if it fired none. */
  lastRunLiveness: (run: OvernightRun) => Promise<RunLiveness | null>;
  /** Put back the claims of sessions that died, before the plan is read. */
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
  recordFire: (featuresLeft: number) => Promise<void>;
  stop: (reason: string) => Promise<void>;
};

/** A run that has stopped, so the next feature may be fired. */
function isOver(liveness: RunLiveness | null): boolean {
  return liveness === null || liveness === 'ended' || liveness === 'finished';
}

/**
 * One account's tick.
 *
 * `unknown` counts as still going, deliberately. It means GitHub could not be
 * asked, and silence the app could not hear is not evidence that a session
 * stopped -- firing on it is how two sessions end up building the same feature
 * at once. A night that stays unknown fires nothing and ends on its own stop
 * time, which is the safe way round.
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

  const liveness = await ports.lastRunLiveness(run);
  if (!isOver(liveness)) return { act: 'waiting', liveness: liveness as RunLiveness };

  // Before the tree is read, and only on the tick that will choose from it.
  //
  // A session that died mid-feature left its step saying `in_progress`, and
  // nothing puts that back overnight: the sweep is a stage of the daily cron.
  // So the step is not ready, the send guard refuses the feature above it, and
  // one dead run holds up the rest of the night. Sweeping here means the claim
  // goes back within one tick of ageing out and the tree loaded a line later
  // shows the step as the not-started work it is.
  //
  // Nothing is swept on a tick that is idle, paused, ended or still waiting on
  // a live session: those ticks write nothing at all, which is the whole shape
  // of this function, and a claim nobody is working keeps just as well until
  // the tick that could actually use it.
  //
  // A sweep that fails is logged and stepped over rather than thrown. It is a
  // tidying pass, not a precondition: without it the tick chooses from the tree
  // as it stands, which is exactly what every night did before this, and a
  // night that gave up on one unreadable table would cost itself every feature
  // it could still have fired.
  try {
    await ports.sweepClaims();
  } catch (err) {
    console.error(
      `stale claims could not be swept before the overnight tick chose: ${
        err instanceof Error ? err.message : 'failed'
      }`,
    );
  }

  const [sections, lastFiredAt] = await Promise.all([ports.loadSections(), ports.lastFiredAt()]);

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
  let remaining: readonly PlanSection[] = sections;
  const rounds = sections.reduce((total, section) => total + section.nodes.length, 0) + 1;

  for (let round = 0; round < rounds; round += 1) {
    const choice = chooseOvernightFire(remaining, run, ports.now, lastFiredAt);
    if (choice.act === 'end') {
      // The chooser can only say the tree ran out, and once anything has been
      // refused that is no longer the whole truth: the reason has to name them,
      // because the row's sentence is all the morning gets.
      const reason =
        refused.length > 0 ? overnightRefusedReason(refused, choice.reason) : choice.reason;
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
        featuresLeft: Math.max(0, run.featuresLeft - 1),
        refused: refused.map((one) => one.number),
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
 * The newest close on a step or anything beneath it, or null if nothing has.
 *
 * `plan_subtree_closed_at` (migration 0089) walks the subtree in one indexed
 * statement rather than the tick pulling the tree over the wire every four
 * minutes to answer a question about one branch of it.
 *
 * A function that cannot be reached falls back to the feature row alone. That
 * is the reading this code took before 0089 -- too strict, never wrong -- and
 * a runner that answered `unknown` here would stop firing for the rest of the
 * night over a failed lookup, which is a worse trade than being slow.
 */
async function subtreeClosedAt(supabase: Db, root: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('plan_subtree_closed_at', { root });
  if (!error) return (data as string | null) ?? null;

  console.error(`plan_subtree_closed_at could not be read; falling back: ${error.message}`);
  const { data: item } = await supabase
    .from('plan_items')
    .select('completed_at')
    .eq('id', root)
    .maybeSingle();
  return (item as { completed_at: string | null } | null)?.completed_at ?? null;
}

/**
 * What the feature this night last fired is doing.
 *
 * Null when the night has fired nothing yet, which is the first tick of every
 * night. Otherwise the newest feature run is found and read: a row already
 * written back as finished or failed is over and costs nothing further, and
 * one still marked started is judged from what has been pushed since it began,
 * by the same `runLiveness` the plan page uses.
 *
 * A newest run older than the fire this row records means the run that was
 * fired left no record -- `startRoutineRun` logs a failed insert and carries
 * on -- and that is `unknown` rather than `ended`: something was started and
 * the app cannot see it.
 */
async function lastFireLiveness(input: {
  supabase: Db;
  userId: string;
  run: OvernightRun;
  now: number;
  fetch?: typeof globalThis.fetch;
}): Promise<RunLiveness | null> {
  const { supabase, userId, run } = input;
  if (!run.lastFiredAt) return null;

  const { data, error } = await supabase
    .from('plan_runs')
    .select('id, plan_item_id, status, created_at')
    .eq('user_id', userId)
    .eq('job', 'feature')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`plan_runs could not be read for the overnight tick: ${error.message}`);
    return 'unknown';
  }
  const last = data as { plan_item_id: string | null; status: string; created_at: string } | null;
  if (!last) return 'unknown';

  const fired = new Date(run.lastFiredAt).getTime();
  if (new Date(last.created_at).getTime() < fired - FIRE_WINDOW_MS) return 'unknown';

  if (last.status === 'finished') return 'finished';
  if (last.status === 'failed') return 'ended';

  // Still marked started, which is the ordinary case at three in the morning:
  // nothing sweeps these rows while nobody has the plan page open.
  //
  // The whole subtree, not the feature row. A run is fired at a feature and a
  // feature closes only once every step beneath it closes, so a feature with
  // one blocked or `proposed` step never closes and this test never fired --
  // which sent every run to the two-hour silence fallback below, however well
  // it had gone. See 0089 for the nights that measured it.
  let closedAt: string | null = null;
  if (last.plan_item_id) {
    closedAt = await subtreeClosedAt(supabase, last.plan_item_id);
  }

  const since = new Date(last.created_at).getTime();
  const { pushes, error: pushError } = await listPushes({ since, fetch: input.fetch });
  return runLiveness(
    {
      startedAt: last.created_at,
      lastPush: pushError ? null : lastPushSince(pushes, last.created_at),
      stepClosedAt: closedAt,
      read: !pushError,
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
    lastRunLiveness: (run) => lastFireLiveness({ supabase, userId, run, now, fetch: input.fetch }),
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
  /** Features started, which is at most one per account. */
  fired: number;
  /** What happened to each, by user id, so the response says why nothing did. */
  results: Record<string, OvernightTick>;
  /**
   * What CI said about main's newest commit, read on this tick whether or not
   * anything was running. In the response so that a tick can be poked by hand
   * and the reading it took read back from what it answers.
   */
  main: { sha: string | null; conclusion: CheckConclusion | null; error: string | null };
};

/**
 * The cron's entry point: main's CI, then every account mid-run, one feature
 * at most each.
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
  let main: OvernightTickSummary['main'] = { sha: null, conclusion: null, error: null };
  try {
    main = await refreshMainCheck({ supabase, now, fetch: input.fetch });
  } catch (err) {
    const said = err instanceof Error ? err.message : 'failed';
    console.error(`main's CI could not be read on this tick: ${said}`);
    main = { sha: null, conclusion: null, error: said };
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
      // A tick that fires says so; a tick that waits used to say nothing at
      // all, and the run that waited two hours for a session which had already
      // merged looked exactly like a quiet night. The reason is the whole
      // diagnosis, so it goes in the log beside the fires.
      if (tick.act === 'waiting') {
        console.log(`overnight: waiting -- the last run reads ${tick.liveness}.`);
      }
      if (tick.act === 'ended') console.log(`overnight: ended -- ${tick.reason}`);
    } catch (err) {
      results[userId] = { act: 'failed', error: err instanceof Error ? err.message : 'failed' };
    }
  }

  return { accounts: users.length, fired, results, main };
}
