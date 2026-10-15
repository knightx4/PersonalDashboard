'use client';

import type { ActionMenuItem } from '@/components/ui/action-menu';
import { useToast } from '@/components/ui/toast';
import type { GoalStatus } from '@/lib/goals/tree';
import { archiveGoalAction, settleGoalAction } from './actions';

/**
 * Putting a goal away (plan #2097.1): Park goal and Archive goal, from the
 * goal's own page and from its row on All goals. Park is the move Today's
 * offer makes, and its undo takes the goal back up; Archive is the archive
 * with its restore. Either way the steps stay under the goal and come back
 * with it. Each takes a list of goals, so putting several away at once is the
 * same write with one undo for the lot.
 */
export type PutAway = 'park' | 'archive';

/** The goals a menu can put away: open ones can be parked, live ones archived. */
export type PutAwayGoal = {
  id: string;
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

/**
 * What the toast says once the goals have gone: the move and where to find
 * them, kept short enough that a phone's toast does not cut it off. The goal
 * is the one just pressed, so it goes unnamed; several are counted.
 */
export function putAwayText(count: number, how: PutAway): string {
  const verb = how === 'park' ? 'Parked' : 'Archived';
  if (count === 1) return `${verb}. It is under Everything.`;
  return `${verb} ${count} goals. See Everything.`;
}

/** The confirm Archive asks first, naming the steps that go with the goal. */
export function archiveConfirm(steps: number): string {
  if (steps === 0) return 'Archive this goal? It has no steps yet.';
  return `Archive this goal and its ${steps} ${steps === 1 ? 'step' : 'steps'}? They come back if you restore it.`;
}

/**
 * Park goal and Archive goal as menu items for one goal. Park is offered on an
 * open goal, Archive on any goal not archived already. `onGone` runs once the
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
      text: putAwayText(1, how),
      undo: () => bringBackGoals([goal.id], how),
    });
  }

  if (goal.archivedAt) return [];
  const items: ActionMenuItem[] = [];
  if (goal.status === 'open') {
    items.push({ id: 'park', label: 'Park goal', onSelect: () => void putAway('park') });
  }
  items.push({
    id: 'archive',
    label: 'Archive goal',
    destructive: true,
    confirm: archiveConfirm(steps),
    onSelect: () => void putAway('archive'),
  });
  return items;
}
