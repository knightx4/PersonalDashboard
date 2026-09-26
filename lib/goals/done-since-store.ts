import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  doneSince,
  resultStepOf,
  type DoneGoal,
  type DoneRun,
  type DoneSince,
  type ResultStep,
} from '@/lib/goals/done-since';
import { loadRunChanges } from '@/lib/goals/run-changes-store';
import { loadRunsEndedSince } from '@/lib/goals/runs-store';

/**
 * Reads for the list of what Dash did since your last visit (plan #1076).
 * The rules are in lib/goals/done-since.ts; each run's changes are read the
 * way its own page reads them (loadRunChanges), so an undo on the home and
 * one on the run's page are the same line. Every read goes through the
 * signed-in client, so row level security keeps it to your own runs.
 */

/** Ids per request, to keep the query string short. */
const CHUNK = 100;

/** Steps sit a few levels under their goal; this stops a broken chain looping. */
const MAX_DEPTH = 12;

/** Far past the unread results anyone keeps; the oldest wait on the goal page. */
const UNREAD_LIMIT = 50;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

type ItemRow = { id: string; parent_id: string | null; level: string; title: string };

/** The goal each item sits under, walking up parent_id a level per read. */
export async function goalsFor(
  client: GoalsSupabaseClient,
  itemIds: readonly string[],
): Promise<Map<string, DoneGoal>> {
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

  const goals = new Map<string, DoneGoal>();
  for (const id of itemIds) {
    let item = items.get(id);
    for (let depth = 0; item && item.level !== 'goal' && depth < MAX_DEPTH; depth += 1) {
      item = item.parent_id ? items.get(item.parent_id) : undefined;
    }
    if (item?.level === 'goal') goals.set(id, { id: item.id, title: item.title });
  }
  return goals;
}

type StepRow = {
  id: string;
  title: string;
  kind: string;
  reviewed_at: string | null;
  updated_at: string;
};

const STEP_COLUMNS = 'id, title, kind, reviewed_at, updated_at';

/** The steps the window's result lines name, left out once archived, and which still hold a result. */
async function resultSteps(
  client: GoalsSupabaseClient,
  ids: readonly string[],
): Promise<{ rows: StepRow[]; holding: Set<string> }> {
  const rows: StepRow[] = [];
  const holding = new Set<string>();
  for (const part of chunks(ids)) {
    const [all, held] = await Promise.all([
      client.from('items').select(STEP_COLUMNS).in('id', part).is('archived_at', null),
      client
        .from('items')
        .select('id')
        .in('id', part)
        .or('result.not.is.null,result_url.not.is.null'),
    ]);
    if (all.error) throw new Error(`Could not read the results: ${all.error.message}`);
    if (held.error) throw new Error(`Could not read the results: ${held.error.message}`);
    rows.push(...((all.data ?? []) as StepRow[]));
    for (const row of (held.data ?? []) as { id: string }[]) holding.add(row.id);
  }
  return { rows, holding };
}

/** Claude's results you have not marked read, from any time (the rule in lib/goals/daily.ts, awaitsReview). */
async function unreadResults(client: GoalsSupabaseClient): Promise<StepRow[]> {
  const { data, error } = await client
    .from('items')
    .select(STEP_COLUMNS)
    .eq('kind', 'claude')
    .is('reviewed_at', null)
    .is('archived_at', null)
    .neq('status', 'dropped')
    .or('result.not.is.null,result_url.not.is.null')
    .order('updated_at', { ascending: false })
    .limit(UNREAD_LIMIT);
  if (error) throw new Error(`Could not read the results waiting to be read: ${error.message}`);
  return (data ?? []) as StepRow[];
}

/** The list for the home, from the visit before this sitting. */
export async function loadDoneSince(
  client: GoalsSupabaseClient,
  since: string,
): Promise<DoneSince> {
  const runs = (await loadRunsEndedSince(client, since)).filter((run) => run.status !== 'started');
  const [lines, unread] = await Promise.all([
    Promise.all(runs.map((run) => loadRunChanges(client, run.id))),
    unreadResults(client),
  ]);

  const windowIds = [
    ...new Set(lines.flatMap((list) => list.flatMap((line) => resultStepOf(line) ?? []))),
  ];
  const window = await resultSteps(client, windowIds);
  const stepRows = new Map<string, { row: StepRow; hasResult: boolean }>();
  for (const row of window.rows) stepRows.set(row.id, { row, hasResult: window.holding.has(row.id) });
  for (const row of unread) stepRows.set(row.id, { row, hasResult: true });

  const goals = await goalsFor(client, [
    ...runs.flatMap((run) => (run.item ? [run.item.id] : [])),
    ...stepRows.keys(),
  ]);

  const done: DoneRun[] = runs.map((run, i) => ({
    run,
    lines: lines[i],
    goal: run.item ? (goals.get(run.item.id) ?? null) : null,
  }));
  const steps = new Map<string, ResultStep>();
  for (const [id, { row, hasResult }] of stepRows) {
    steps.set(id, {
      id,
      title: row.title,
      kind: row.kind,
      hasResult,
      reviewedAt: row.reviewed_at,
      updatedAt: row.updated_at,
      goal: goals.get(id) ?? null,
    });
  }
  return doneSince(since, done, steps);
}
