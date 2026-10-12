import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { ClosedStepToday, ProgressToday } from '@/lib/goals/done-today';

/**
 * The goal rows Home's Done today reads (plan #1740): steps closed since
 * `since` and progress logged since then that has not been undone, each with
 * the goal it sits under. The joining is in lib/goals/done-today.ts.
 *
 * The goal is found by walking up the parents a level at a time, since a
 * step can sit several steps deep; a day's rows touch few branches, so this
 * reads a handful of rows rather than the whole tree.
 */

/** How deep a step may sit before the walk gives up on finding its goal. */
const MAX_DEPTH = 12;
/** The most rows of each kind read for one day. */
const LIMIT = 50;

type Node = { id: string; parentId: string | null; level: string; title: string };

export async function loadGoalsDoneToday(
  client: GoalsSupabaseClient,
  userId: string,
  since: string,
): Promise<{ steps: ClosedStepToday[]; progress: ProgressToday[] }> {
  const [closed, logged] = await Promise.all([
    client
      .from('items')
      .select('id, parent_id, level, title, closed_at')
      .eq('user_id', userId)
      .eq('level', 'step')
      .eq('status', 'done')
      .is('archived_at', null)
      .gte('closed_at', since)
      .order('closed_at', { ascending: false })
      .limit(LIMIT),
    client
      .from('progress_entries')
      .select('id, item_id, text, quantity, unit, created_at')
      .eq('user_id', userId)
      .is('undone_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
  ]);
  if (closed.error) throw new Error(closed.error.message);
  if (logged.error) throw new Error(logged.error.message);

  const nodes = new Map<string, Node>();
  for (const row of closed.data ?? []) {
    nodes.set(row.id as string, {
      id: row.id as string,
      parentId: (row.parent_id as string | null) ?? null,
      level: row.level as string,
      title: row.title as string,
    });
  }

  // Every row the day's lines need to reach their goal, a level at a time.
  let wanted = new Set<string>([
    ...[...nodes.values()].map((n) => n.parentId).filter((id): id is string => !!id),
    ...(logged.data ?? []).map((row) => row.item_id as string),
  ]);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const missing = [...wanted].filter((id) => !nodes.has(id));
    if (missing.length === 0) break;
    const { data, error } = await client
      .from('items')
      .select('id, parent_id, level, title')
      .in('id', missing)
      .is('archived_at', null);
    if (error) throw new Error(error.message);
    wanted = new Set<string>();
    for (const row of data ?? []) {
      const node: Node = {
        id: row.id as string,
        parentId: (row.parent_id as string | null) ?? null,
        level: row.level as string,
        title: row.title as string,
      };
      nodes.set(node.id, node);
      if (node.level !== 'goal' && node.parentId) wanted.add(node.parentId);
    }
  }

  const goalOf = (id: string | null): Node | null => {
    let at = id ? nodes.get(id) : undefined;
    for (let depth = 0; at && depth <= MAX_DEPTH; depth++) {
      if (at.level === 'goal') return at;
      at = at.parentId ? nodes.get(at.parentId) : undefined;
    }
    return null;
  };

  const steps: ClosedStepToday[] = [];
  for (const row of closed.data ?? []) {
    const goal = goalOf(row.parent_id as string | null);
    if (!goal) continue;
    steps.push({
      id: row.id as string,
      title: row.title as string,
      goalId: goal.id,
      goalTitle: goal.title,
      closedAt: row.closed_at as string,
    });
  }

  const progress: ProgressToday[] = [];
  for (const row of logged.data ?? []) {
    const item = nodes.get(row.item_id as string);
    if (!item) continue;
    const goal = item.level === 'goal' ? item : goalOf(item.parentId);
    if (!goal) continue;
    const onStep = item.level !== 'goal';
    progress.push({
      id: row.id as string,
      stepId: onStep ? item.id : null,
      stepTitle: onStep ? item.title : null,
      goalId: goal.id,
      goalTitle: goal.title,
      text: (row.text as string | null) ?? '',
      quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
      unit: (row.unit as string | null) ?? null,
      createdAt: row.created_at as string,
    });
  }
  return { steps, progress };
}
