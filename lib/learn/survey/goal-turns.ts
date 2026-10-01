import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { loadActiveAims } from '@/lib/learn/aims-store';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { GoalAim } from './goal-question';
import { goalsInTurn } from './rate';

/**
 * The goals Practice Flow takes goal turns for (plan #1385), in the order
 * they take them.
 *
 * Only open goals: the active ones with no list behind them. The Level 3 goal
 * is asked about through its claimed articles (#1386), and an archived goal is
 * not asked about at all. The one with the fewest questions written about it
 * goes first, counting the ones waiting in the queue, so two goals alternate
 * and a new goal is asked about straight away.
 *
 * Read through the session, so RLS keeps every row to the viewer's own.
 */

/** Ids per `in` filter. */
const CHUNK = 100;

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

async function inChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  action: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < ids.length; from += CHUNK) {
    const { data, error } = await read(ids.slice(from, from + CHUNK));
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail(action, error);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/** The open goals, the one asked about least first. Empty with none. */
export async function loadGoalsInTurn(supabase: LearnSupabaseClient): Promise<GoalAim[]> {
  const goals: GoalAim[] = (await loadActiveAims(supabase))
    .filter((aim) => aim.listSource === null)
    .map((aim) => ({
      id: aim.id,
      name: aim.name,
      about: aim.about,
      depth: aim.depth,
      listSource: aim.listSource,
    }));
  if (goals.length === 0) return [];

  const { data, error } = await supabase
    .from('subjects')
    .select('id, aim_id')
    .eq('survey', true)
    .in(
      'aim_id',
      goals.map((goal) => goal.id),
    );
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail("Reading your goals' questions", error);
  const aimOf = new Map(
    ((data ?? []) as { id: string; aim_id: string }[]).map((row) => [row.id, row.aim_id]),
  );

  const concepts = await inChunks<{ id: string; subject_id: string }>(
    [...aimOf.keys()],
    (chunk) => supabase.from('concepts').select('id, subject_id').in('subject_id', chunk),
    "Reading your goals' ideas",
  );
  const subjectOf = new Map(concepts.map((row) => [row.id, row.subject_id]));
  const probes = await inChunks<{ concept_id: string }>(
    [...subjectOf.keys()],
    (chunk) =>
      supabase.from('probes').select('concept_id').in('concept_id', chunk).is('discarded_at', null),
    "Reading your goals' questions",
  );

  const asked = new Map<string, number>();
  for (const probe of probes) {
    const aimId = aimOf.get(subjectOf.get(probe.concept_id) ?? '');
    if (aimId) asked.set(aimId, (asked.get(aimId) ?? 0) + 1);
  }
  return goalsInTurn(goals, asked);
}
