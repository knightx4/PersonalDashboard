'use client';

import type { ActionMenuItem } from '@/components/ui/action-menu';
import { useToast } from '@/components/ui/toast';
import { closedToast, type Lifecycle } from '@/lib/core/lifecycle';
import type { GoalStatus } from '@/lib/goals/tree';
import { archiveGoalAction, settleGoalAction } from './actions';

/**
 * Putting a goal away (plan #2097.1): Later and Drop, from the goal's own
 * page and from its row on All goals. Later parks the goal, the move Today's
 * offer makes, and its undo takes the goal back up; Drop archives it, with
 * the archive's restore as its undo (plan #1957.8: the four closing words). Either way the steps stay under the goal and come back
 * with it. Each takes a list of goals, so putting several away at once is the
 * same write with one undo for the lot.
 */
export type PutAway = 'park' | 'archive';

/** The goals a menu can put away: open ones can be parked, live ones archived. */
export type PutAwayGoal = {
  id: string;
  /** For the toast, which names the goal it put away. */
  title?: string;
  status: GoalStatus;
  archivedAt?: string | null;
};

async function writeOne(id: string, how: PutAway, back: boolean) {
  const form = new FormData();
  form.set('id', id);
  if (how === 'archive') {
    if (back) form.set('restore', 'true');
    return archiveGoalAction(form);
  }
  form.set('move', back ? 'reopen' : 'park');
  return settleGoalAction({}, form);
}

/**
 * Park or archive each goal, one at a time. Returns the ids that went, and
 * the first refusal; goals put away before a refusal stay put away, so the
 * caller's undo is offered for those.
 */
export async function putAwayGoals(
  ids: readonly string[],
  how: PutAway,
): Promise<{ done: string[]; error?: string }> {
  const done: string[] = [];
  for (const id of ids) {
    const result = await writeOne(id, how, false);
    if (result.error) return { done, error: result.error };
    done.push(id);
  }
  return { done };
}

/** The undo: take parked goals back up, or restore archived ones. Throws on a refusal, for the toast. */
export async function bringBackGoals(ids: readonly string[], how: PutAway): Promise<void> {
  for (const id of ids) {
    const result = await writeOne(id, how, true);
    if (result.error) throw new Error(result.error);
  }
}

/** The closing word each way of putting a goal away wears. */
export const PUT_AWAY_LIFECYCLE: Record<PutAway, Lifecycle> = { park: 'later', archive: 'dropped' };

/**
 * What the toast says once the goals have gone: the ending and the goal it
 * closed (plan #1957.8). Several are counted, with where to find them.
 */
export function putAwayText(count: number, how: PutAway, title?: string): string {
  const lifecycle = PUT_AWAY_LIFECYCLE[how];
  if (count === 1) return closedToast(lifecycle, title);
  return closedToast(lifecycle, `${count} goals. See Everything.`);
}

/** The confirm Drop asks first, naming the steps that go with the goal. */
export function archiveConfirm(steps: number): string {
  if (steps === 0) return 'Drop this goal? It has no steps yet.';
  return `Drop this goal and its ${steps} ${steps === 1 ? 'step' : 'steps'}? They come back if you restore it.`;
}

/**
 * Later and Drop as menu items for one goal. Later is offered on an open
 * goal, Drop on any goal not archived already. `onGone` runs once the
 * goal is put away, before the toast, so the goal's own page can go back to
 * All goals and show the toast there.
 */
export function usePutAwayItems(
  goal: PutAwayGoal,
  steps: number,
  onGone?: () => void,
): ActionMenuItem[] {
  const toast = useToast();

  async function putAway(how: PutAway) {
    const result = await putAwayGoals([goal.id], how);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    onGone?.();
    toast({
      text: putAwayText(1, how, goal.title),
      undo: () => bringBackGoals([goal.id], how),
    });
  }

  if (goal.archivedAt) return [];
  const items: ActionMenuItem[] = [];
  if (goal.status === 'open') {
    items.push({
      id: 'park',
      label: 'Park goal',
      lifecycle: 'later',
      onSelect: () => void putAway('park'),
    });
  }
  items.push({
    id: 'archive',
    label: 'Archive goal',
    lifecycle: 'dropped',
    destructive: true,
    confirm: archiveConfirm(steps),
    onSelect: () => void putAway('archive'),
  });
  return items;
}
