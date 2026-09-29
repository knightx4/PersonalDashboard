import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import {
  ACTED_QUESTION,
  ACTED_WINDOW_MS,
  actedAt,
  actedCandidate,
  actedFlag,
  actedState,
  type ClosedStep,
} from '@/lib/goals/acted-flags';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { checkActs } from '@/lib/goals/hold-acts';
import { decideWithJev } from '@/lib/jev/decide';
import { jevEnabledFor } from '@/lib/jev/enabled';

/**
 * The check behind plan #1184, a stage of the overnight tick, which pg_cron
 * calls every four minutes. The rules are in lib/goals/acted-flags.ts.
 *
 * It reads the goals runs that finished in the last day and have not been
 * checked (goals.runs.acts_checked_at, migrations-goals/0059), finds the
 * steps each one closed from goals.history, and asks Jev about every Claude
 * step among them with no approved `acts` sentence. A yes of 0.5 or more
 * writes a flag on the step's goal in public.raised_items. The flag's source
 * names the step, and a unique index on it keeps it to one flag per step
 * however often the close is read again.
 *
 * A run is marked checked once Jev has answered for every step it closed, so
 * a Jev outage is retried on the next tick rather than read as a no. Nothing
 * is asked for an account that has not agreed to send its text to TypeSafe
 * (jevEnabledFor), and its runs are left unchecked.
 */

/** Far more finished runs than a day produces. */
const RUN_LIMIT = 100;

export type ActedFlagged = { stepId: string; goalId: string; title: string; probability: number };

export type ActedRunsResult = {
  /** Runs marked checked this tick. */
  runs: number;
  /** Steps put to Jev. */
  checked: number;
  /** Steps Jev did not answer for; their runs are read again next tick. */
  unanswered: number;
  /** Flags written this tick; a step flagged before is not counted again. */
  flagged: ActedFlagged[];
};

export type ActedRunsInput = {
  client: GoalsSupabaseClient;
  now?: number;
  /** Stand-ins for tests. */
  ask?: (step: ClosedStep) => Promise<number | null>;
  enabled?: (userId: string) => Promise<boolean>;
};

type RunRow = { id: string; user_id: string };
type HistoryRow = { run_id: string; row_id: string; new_values: Record<string, unknown> | null };
type ItemRow = {
  id: string;
  user_id: string;
  parent_id: string | null;
  level: string;
  kind: string | null;
  title: string;
  acts: string | null;
  approved_at: string | null;
  result: string | null;
  evidence: string | null;
  resolution: string | null;
};
type TreeRow = { id: string; parent_id: string | null; level: string };

/** The goal above a step, walking up through phases. */
function goalAbove(tree: Map<string, TreeRow>, id: string): string | null {
  let at = tree.get(id);
  for (let hops = 0; at && hops < 100; hops += 1) {
    if (at.level === 'goal') return at.id;
    at = at.parent_id ? tree.get(at.parent_id) : undefined;
  }
  return null;
}

/** Each unchecked finished run's closes, as the check reads them, by user. */
async function loadCloses(
  client: GoalsSupabaseClient,
  runs: readonly RunRow[],
): Promise<Map<string, ClosedStep[]>> {
  const history = await client
    .from('history')
    .select('run_id, row_id, new_values')
    .in('run_id', runs.map((run) => run.id))
    .eq('table_name', 'items')
    .in('action', ['insert', 'update']);
  if (history.error) throw new Error(`Could not read what the runs changed: ${history.error.message}`);
  const closes = ((history.data ?? []) as HistoryRow[]).filter((row) => row.new_values?.status === 'done');
  if (closes.length === 0) return new Map();

  const users = [...new Set(runs.map((run) => run.user_id))];
  const [items, tree] = await Promise.all([
    client
      .from('items')
      .select('id, user_id, parent_id, level, kind, title, acts, approved_at, result, evidence, resolution')
      .in('id', [...new Set(closes.map((row) => row.row_id))])
      .in('user_id', users)
      .eq('level', 'step')
      .is('archived_at', null),
    client.from('items').select('id, parent_id, level').in('user_id', users).is('archived_at', null),
  ]);
  if (items.error) throw new Error(`Could not read the closed steps: ${items.error.message}`);
  if (tree.error) throw new Error(`Could not read the goals: ${tree.error.message}`);
  const byId = new Map(((items.data ?? []) as ItemRow[]).map((row) => [row.id, row]));
  const skeleton = new Map(((tree.data ?? []) as TreeRow[]).map((row) => [row.id, row]));
  const owner = new Map(runs.map((run) => [run.id, run.user_id]));

  const byUser = new Map<string, ClosedStep[]>();
  const seen = new Set<string>();
  for (const close of closes) {
    const item = byId.get(close.row_id);
    const userId = owner.get(close.run_id);
    if (!item || item.user_id !== userId || seen.has(item.id)) continue;
    const goalId = goalAbove(skeleton, item.id);
    if (!goalId) continue;
    const step: ClosedStep = {
      id: item.id,
      runId: close.run_id,
      goalId,
      title: item.title,
      kind: item.kind,
      acts: item.acts,
      approvedAt: item.approved_at,
      result: item.result,
      evidence: item.evidence,
      resolution: item.resolution,
    };
    if (!actedCandidate(step)) continue;
    seen.add(item.id);
    byUser.set(userId, [...(byUser.get(userId) ?? []), step]);
  }
  return byUser;
}

export async function flagActedRuns(input: ActedRunsInput): Promise<ActedRunsResult> {
  const { client } = input;
  const now = input.now ?? Date.now();
  const core = client.schema('core') as unknown as CoreSupabaseClient;
  const enabled = input.enabled ?? ((userId: string) => jevEnabledFor(core, userId));

  const found = await client
    .from('runs')
    .select('id, user_id')
    .neq('status', 'started')
    .is('acts_checked_at', null)
    .gte('ended_at', new Date(now - ACTED_WINDOW_MS).toISOString())
    .order('ended_at', { ascending: true })
    .limit(RUN_LIMIT);
  if (found.error) throw new Error(`Could not read finished goal runs: ${found.error.message}`);
  const allRuns = (found.data ?? []) as RunRow[];
  const result: ActedRunsResult = { runs: 0, checked: 0, unanswered: 0, flagged: [] };
  if (allRuns.length === 0) return result;

  const consenting = new Set<string>();
  for (const userId of new Set(allRuns.map((run) => run.user_id))) {
    if (await enabled(userId)) consenting.add(userId);
  }
  const runs = allRuns.filter((run) => consenting.has(run.user_id));
  if (runs.length === 0) return result;

  const byUser = await loadCloses(client, runs);
  const retry = new Set<string>();

  for (const [userId, steps] of byUser) {
    const spend: SpendReport[] = [];
    const ask =
      input.ask ??
      (async (step: ClosedStep) => {
        const decided = await decideWithJev({
          state: actedState(step),
          question: ACTED_QUESTION,
          // Jev's answer always stands; the line is on its probability.
          floor: 0,
          read: (answer) => answer.probability,
          fallback: async () => null,
          onSpend: (report) => spend.push(report),
        });
        return decided.value;
      });
    const checks = await checkActs(steps, ask, undefined, actedAt);
    result.checked += checks.length;

    for (const check of checks) {
      if (check.probability === null) {
        result.unanswered += 1;
        retry.add(check.step.runId);
        continue;
      }
      if (!check.held) continue;
      const flag = actedFlag(check.step);
      const written = await client.schema('public').from('raised_items').insert({
        user_id: userId,
        module: 'goals',
        goal_id: flag.goalId,
        title: flag.title,
        detail: flag.detail,
        ask: flag.ask,
        source: flag.source,
      });
      if (written.error) {
        // 23505: this step was flagged before, by an earlier run or tick.
        if (written.error.code !== '23505') {
          console.warn(`[goals] acted flag on ${check.step.id} not written: ${written.error.message}`);
          retry.add(check.step.runId);
        }
        continue;
      }
      result.flagged.push({
        stepId: check.step.id,
        goalId: flag.goalId,
        title: check.step.title,
        probability: check.probability,
      });
    }

    await recordSpendReports(core, userId, { module: 'goals', operation: 'check-run-acts' }, spend).catch(
      (error: unknown) => {
        console.warn(`[goals] acted check spend not recorded: ${error instanceof Error ? error.message : 'failed'}`);
      },
    );
  }

  const done = runs.filter((run) => !retry.has(run.id)).map((run) => run.id);
  if (done.length > 0) {
    const marked = await client
      .from('runs')
      .update({ acts_checked_at: new Date(now).toISOString() })
      .in('id', done)
      .is('acts_checked_at', null)
      .select('id');
    if (marked.error) throw new Error(`Could not mark the runs checked: ${marked.error.message}`);
    result.runs = (marked.data ?? []).length;
  }
  return result;
}
