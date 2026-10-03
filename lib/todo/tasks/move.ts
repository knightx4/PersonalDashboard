import type { Move } from '@/lib/core/move';
import type { Task } from './model';

/**
 * Whose move a todo is (plan #1454; docs/CORE-AND-DASH-SPEC.md, Part 3). A
 * todo is something you wrote down to do, so an open one is on you, snoozed
 * or not. A ticked or dropped one has nothing left and shows no move. Handing
 * a todo to Dash closes it and makes an errand on Goals, which carries its
 * own move there.
 */
export function taskMove(task: Pick<Task, 'status'>): { move: Move; title: string } | null {
  if (task.status !== 'open') return null;
  return { move: { state: 'on_you' }, title: 'Yours to do.' };
}
