import 'server-only';

import { readWaiting, type DashRunning, type WaitingItem } from '@/lib/goals/daily';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { JOB_LABELS, toRunListings, type RunRowWithItem } from '@/lib/goals/runs';
import { runInFlight, runProgress } from '@/lib/goals/shaping';

/**
 * What the Goals home reads beyond the step trees: the context and drafts
 * Claude found for each goal, which wait on you to read, and the runs going
 * now, which are Dash's. Row level security keeps each to your own rows.
 */
export async function loadHomeExtras(
  client: GoalsSupabaseClient,
  titles: ReadonlyMap<string, string>,
  now: number,
): Promise<{ waiting: WaitingItem[]; running: DashRunning[] }> {
  const [context, drafts, served, runs] = await Promise.all([
    client.from('context').select('item_id').eq('status', 'proposed'),
    client.from('records').select('collection_id').eq('draft', true).is('archived_at', null),
    client.from('collection_goals').select('collection_id, goal_id').is('archived_at', null),
    client
      .from('runs')
      .select(
        'id, job, status, created_at, ended_at, summary, error, last_seen_at, now_on, item:items!runs_item_fk(id, title, level), area:areas!runs_area_fk(id, name)',
      )
      .eq('status', 'started')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  for (const read of [context, drafts, served, runs]) {
    if (read.error) throw new Error(`Could not read the home: ${read.error.message}`);
  }

  const contextByGoal = new Map<string, number>();
  for (const row of (context.data ?? []) as { item_id: string }[]) {
    contextByGoal.set(row.item_id, (contextByGoal.get(row.item_id) ?? 0) + 1);
  }
  const draftsByCollection = new Map<string, number>();
  for (const row of (drafts.data ?? []) as { collection_id: string }[]) {
    draftsByCollection.set(row.collection_id, (draftsByCollection.get(row.collection_id) ?? 0) + 1);
  }
  const draftsByGoal = new Map<string, number>();
  for (const row of (served.data ?? []) as { collection_id: string; goal_id: string }[]) {
    const count = draftsByCollection.get(row.collection_id) ?? 0;
    if (count > 0) draftsByGoal.set(row.goal_id, (draftsByGoal.get(row.goal_id) ?? 0) + count);
  }

  const running = toRunListings((runs.data ?? []) as unknown as RunRowWithItem[])
    .filter((run) => runInFlight(run, now))
    .map((run) => ({
      id: run.id,
      label: JOB_LABELS[run.job],
      on: run.item?.title ?? run.area?.name ?? null,
      progress: runProgress(run, now),
    }));

  return { waiting: readWaiting(contextByGoal, draftsByGoal, titles), running };
}
