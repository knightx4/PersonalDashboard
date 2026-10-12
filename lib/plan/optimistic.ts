import type { PlanItem, PlanPriority, PlanStatus } from './load';

type Assignee = PlanItem['assignee'];

/**
 * The row controls drawn before the server answers.
 *
 * Status, priority, assignee and reorder on /dev/plan change the row the moment
 * they are pressed (plan #1850). These are the pure halves of that: what a
 * change does to the row, and what a swap does to a list of sibling ids. The
 * hook that holds them, and puts the row back when the write is refused, is
 * `useOptimisticWrite`.
 */

/** The three fields a row control sets on the row it sits on. */
export type RowFields = {
  status: PlanStatus;
  priority: PlanPriority;
  assignee: Assignee;
};

export type RowChange =
  | { kind: 'status'; status: PlanStatus }
  | { kind: 'priority'; priority: PlanPriority }
  | { kind: 'assignee'; assignee: Assignee };

/**
 * The row after a change, by the same rules the actions write with.
 *
 * Not started takes the Mine mark off, and in progress puts it on a step that
 * had none (`setPlanItemStatus`). The mark on the steps beneath, which the
 * assignee press also writes, arrives with the revalidation.
 */
export function applyRowChange(fields: RowFields, change: RowChange): RowFields {
  switch (change.kind) {
    case 'status':
      return {
        ...fields,
        status: change.status,
        assignee:
          change.status === 'not_started'
            ? null
            : change.status === 'in_progress' && !fields.assignee
              ? 'me'
              : fields.assignee,
      };
    case 'priority':
      return { ...fields, priority: change.priority };
    case 'assignee':
      return { ...fields, assignee: change.assignee };
  }
}

export type SiblingMove = { id: string; direction: 'up' | 'down' };

/** The ids with one swapped a place up or down, or as they were at an end. */
export function swapSibling(ids: readonly string[], move: SiblingMove): readonly string[] {
  const index = ids.indexOf(move.id);
  const target = move.direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ids.length) return ids;

  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The items in the order of `ids`.
 *
 * An item the ids do not name goes last in its served order, and an id with no
 * item is skipped, so a list the server has since changed still draws.
 */
export function inOrder<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): readonly T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const named = ids.flatMap((id) => {
    const item = byId.get(id);
    byId.delete(id);
    return item ? [item] : [];
  });
  return [...named, ...byId.values()];
}
