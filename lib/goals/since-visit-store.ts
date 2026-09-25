import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { loadRunsEndedSince } from '@/lib/goals/runs-store';
import {
  sinceVisit,
  tallyRuns,
  type RunGoal,
  type RunHistoryRow,
  type SinceVisit,
} from '@/lib/goals/since-visit';

/**
 * Reads for the list of what Claude did since your last visit (plan #1010).
 * The rules are in lib/goals/since-visit.ts. Every read goes through the
 * signed-in client, so row level security keeps it to your own runs.
 */

/** Ids per request, to keep the query string short. */
const CHUNK = 100;

/** Far past what a night's runs write. */
const HISTORY_LIMIT = 5000;

/** Steps sit a few levels under their goal; this stops a broken chain looping. */
const MAX_DEPTH = 12;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

type ItemRow = { id: string; parent_id: string | null; level: string; title: string };

/** The goal each item sits under, walking up parent_id a level per read. */
async function goalsFor(
  client: GoalsSupabaseClient,
  itemIds: readonly string[],
): Promise<Map<string, RunGoal>> {
  const items = new Map<string, ItemRow>();
  let wanted = [...new Set(itemIds)];
  for (let depth = 0; wanted.length > 0 && depth < MAX_DEPTH; depth += 1) {
    const next: string[] = [];
    for (const part of chunks(wanted)) {
      const { data, error } = await client
        .from('items')
        .select('id, parent_id, level, title')
        .in('id', part);
      if (error) throw new Error(`Could not read the goals the runs were on: ${error.message}`);
      for (const row of (data ?? []) as ItemRow[]) {
        items.set(row.id, row);
        if (row.level !== 'goal' && row.parent_id && !items.has(row.parent_id)) {
          next.push(row.parent_id);
        }
      }
    }
    wanted = [...new Set(next)];
  }

  const goals = new Map<string, RunGoal>();
  for (const id of itemIds) {
    let item = items.get(id);
    for (let depth = 0; item && item.level !== 'goal' && depth < MAX_DEPTH; depth += 1) {
      item = item.parent_id ? items.get(item.parent_id) : undefined;
    }
    if (item?.level === 'goal') goals.set(id, { id: item.id, title: item.title });
  }
  return goals;
}

async function runHistory(
  client: GoalsSupabaseClient,
  runIds: readonly string[],
): Promise<RunHistoryRow[]> {
  const out: RunHistoryRow[] = [];
  for (const part of chunks(runIds)) {
    const { data, error } = await client
      .from('history')
      .select('run_id, table_name, action, new_values')
      .in('run_id', part)
      .in('table_name', ['items', 'records'])
      .in('action', ['insert', 'update'])
      .limit(HISTORY_LIMIT);
    if (error) throw new Error(`Could not read what the runs did: ${error.message}`);
    out.push(...((data ?? []) as RunHistoryRow[]));
  }
  return out;
}

/** The list for the home, or null when no run ended since `since`. */
export async function loadSinceVisit(
  client: GoalsSupabaseClient,
  since: string,
): Promise<SinceVisit | null> {
  const runs = (await loadRunsEndedSince(client, since)).filter((run) => run.status !== 'started');
  if (runs.length === 0) return null;
  const itemIds = runs.flatMap((run) => (run.item ? [run.item.id] : []));
  const [history, goals] = await Promise.all([
    runHistory(
      client,
      runs.map((run) => run.id),
    ),
    goalsFor(client, itemIds),
  ]);
  return sinceVisit(since, runs, tallyRuns(history), goals);
}
