import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { listPushes } from '@/lib/plan/ci';
import { handFeatureToClaude } from '@/lib/plan/handover';
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
 * costs the whole tree. Only the last one can fire.
 *
 * The one place this departs from "check liveness first" is a night that is
 * already over on its own terms. A budget that is spent or a stop time that
 * has passed ends the night whether or not the last session is still typing:
 * ending means "fire nothing more", not "stop what is running", and a night
 * held open waiting for a session that GitHub cannot be asked about would sit
 * there `running` until morning with nothing written on it -- which is exactly
 * the state the morning report has nothing to say about. Firing is what the
 * liveness check guards, and firing is still behind it.
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
  | { act: 'fired'; feature: number; step: number; featuresLeft: number }
  /** The send itself refused or failed. The night is left running. */
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
  fire: (feature: PlanNode, step: PlanNode) => Promise<{ ok: boolean; error?: string }>;
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

  const [sections, lastFiredAt] = await Promise.all([ports.loadSections(), ports.lastFiredAt()]);
  const choice = chooseOvernightFire(sections, run, ports.now, lastFiredAt);
  if (choice.act === 'end') {
    await ports.stop(choice.reason);
    return { act: 'ended', reason: choice.reason };
  }
  if (choice.act !== 'fire') return { act: choice.act };

  const sent = await ports.fire(choice.feature, choice.step);
  if (!sent.ok) return { act: 'failed', error: sent.error ?? 'The feature could not be sent.' };

  // Only after something was actually started. A budget that went down on a
  // send that never happened is a night that spends itself on nothing.
  await ports.recordFire(run.featuresLeft);
  return {
    act: 'fired',
    feature: choice.feature.number,
    step: choice.step.number,
    featuresLeft: Math.max(0, run.featuresLeft - 1),
  };
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
  let closedAt: string | null = null;
  if (last.plan_item_id) {
    const { data: item } = await supabase
      .from('plan_items')
      .select('completed_at')
      .eq('id', last.plan_item_id)
      .maybeSingle();
    closedAt = (item as { completed_at: string | null } | null)?.completed_at ?? null;
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
      if (!sent.ok) return { ok: false, error: sent.error };
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
};

/**
 * The cron's entry point: every account mid-run, one feature at most each.
 *
 * Only the accounts with `running` set are read, which is what
 * `plan_overnight_runs_running_idx` is for -- on an ordinary night that is one
 * row or none, and a tick that found none did the cheapest possible thing.
 *
 * One account failing does not stop the next: the nights are independent and a
 * broken plan in one should not cost another its night.
 */
export async function runOvernightTick(input: {
  now?: number;
  supabase?: Db;
  fetch?: typeof globalThis.fetch;
} = {}): Promise<OvernightTickSummary> {
  const supabase = input.supabase ?? createServiceSupabase();
  const now = input.now ?? Date.now();

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
    } catch (err) {
      results[userId] = { act: 'failed', error: err instanceof Error ? err.message : 'failed' };
    }
  }

  return { accounts: users.length, fired, results };
}
