import 'server-only';

import type { SessionUser } from '@/lib/auth/session-user';
import { isOwner } from '@/lib/dev/owner';
import { goalsRoutine } from '@/lib/feedback/routine';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { startGoalRun } from '@/lib/goals/shaping-store';
import { errandAreaDefault } from '@/lib/goals/home';
import { insertGoal, loadAreas } from '@/lib/goals/store';

/**
 * Save an errand and start Dash on it, the one press behind Ask Dash on the
 * Goals home when it is a new errand (plan #1262) and Hand to Dash on a Todo
 * task (plan #1263).
 *
 * The errand goes in as the person's own goal, open and approved like any
 * goal they add. The run is started in the same press, and when it cannot
 * start the errand is kept and `message` says why, so the press never loses
 * what was typed. Only a failed save is an `error`.
 */
export type ErrandResult =
  | { ok: true; goalId: string; started: boolean; message: string }
  | { ok: false; error: string };

export async function saveErrandAndStart(input: {
  client: GoalsSupabaseClient;
  user: SessionUser;
  areaId: string;
  title: string;
  dueOn: string;
  detail?: string | null;
}): Promise<ErrandResult> {
  const { client, user, areaId, title, dueOn } = input;
  const detail = input.detail?.trim() ? input.detail.trim() : null;

  let goalId: string | null;
  try {
    goalId = await insertGoal(client, user.id, areaId, { title, errand: true, dueOn, detail });
  } catch {
    return { ok: false, error: 'The errand could not be saved. Try again.' };
  }
  if (!goalId) return { ok: false, error: 'That area is no longer on the page.' };
  return startOnSaved({
    client,
    user,
    goal: { id: goalId, title, errandDueOn: dueOn },
    noun: 'errand',
  });
}

/**
 * Save a goal and start Dash on it, for Ask Dash on the Goals home when it is
 * a new goal. The same press as an errand without the due date: the goal is
 * saved approved, as any goal the person adds is, then a goal run starts, and
 * the goal is kept when the run cannot start. The caller checks the title
 * with parseGoalFields, the rule the goal composer on All goals uses.
 */
export async function saveGoalAndStart(input: {
  client: GoalsSupabaseClient;
  user: SessionUser;
  areaId: string;
  title: string;
}): Promise<ErrandResult> {
  const { client, user, areaId, title } = input;
  let goalId: string | null;
  try {
    goalId = await insertGoal(client, user.id, areaId, { title });
  } catch {
    return { ok: false, error: 'The goal could not be saved. Try again.' };
  }
  if (!goalId) return { ok: false, error: 'That area is no longer on the page.' };
  return startOnSaved({ client, user, goal: { id: goalId, title }, noun: 'goal' });
}

/** Start a goal run on a goal or errand just saved, saying why when it cannot start. */
async function startOnSaved({
  client,
  user,
  goal,
  noun,
}: {
  client: GoalsSupabaseClient;
  user: SessionUser;
  goal: { id: string; title: string; errandDueOn?: string };
  noun: 'errand' | 'goal';
}): Promise<ErrandResult> {
  const goalId = goal.id;
  const kept = (message: string) => ({ ok: true as const, goalId, started: false, message });

  if (!(await isOwner({ user }))) {
    return kept(`The ${noun} is saved. Only the account that owns this app can start Dash on it.`);
  }
  const routine = goalsRoutine();
  if (!routine.id) {
    return kept(
      `The ${noun} is saved. Dash did not start: no goals routine is set on this deployment. Set ` +
        'CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN, then press Ask Dash on its page.',
    );
  }
  try {
    const started = await startGoalRun({
      client,
      userId: user.id,
      goal,
      routine,
      surface: 'thread',
    });
    if (!started.ok) {
      return kept(
        `The ${noun} is saved. Dash could not start (${started.error.replace(/\.$/, '')}). ` +
          'Press Ask Dash on its page to try again.',
      );
    }
  } catch {
    return kept(
      `The ${noun} is saved. Dash could not start. Press Ask Dash on its page to try again.`,
    );
  }
  const saved = noun === 'errand' ? 'Errand saved.' : 'Goal saved.';
  return { ok: true, goalId, started: true, message: `${saved} Dash is on it.` };
}

/**
 * The areas an errand can go in, and the one it starts on: the area of the
 * soonest open errand, otherwise the first (errandAreaDefault). For a place
 * outside Goals that adds an errand, such as Hand to Dash on Todo, which has
 * no Goals home loaded to take them from.
 */
export async function loadErrandAreas(client: GoalsSupabaseClient): Promise<{
  areas: { id: string; name: string }[];
  defaultAreaId: string | null;
}> {
  const areas = (await loadAreas(client)).map((area) => ({ id: area.id, name: area.name }));
  const { data, error } = await client
    .from('items')
    .select('area_id')
    .eq('level', 'goal')
    .eq('errand', true)
    .eq('status', 'open')
    .is('archived_at', null)
    .order('due_on')
    .limit(20);
  if (error) throw new Error(`Could not read errands: ${error.message}`);
  const errands = ((data ?? []) as { area_id: string }[]).map((row) => ({
    goal: { areaId: row.area_id },
  }));
  return { areas, defaultAreaId: errandAreaDefault(errands, areas) };
}
