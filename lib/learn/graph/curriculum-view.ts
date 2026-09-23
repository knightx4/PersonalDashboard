import { pruneForGoal, type Graph } from './model';

/**
 * How a track's curriculum reads on its page (LEARN-GRAPH-SPEC, "The
 * curriculum"). Pure, over what the page already loaded.
 *
 * A unit is not opened until a goal is filed under it. Once one is, it is
 * done when nothing is left standing between you and any of its goals, and in
 * progress otherwise, with the count of ideas still left across its goals.
 * The next unit is the first one, in the curriculum's own order, that is not
 * done: the order is fixed, so the page never suggests skipping ahead.
 */

export type UnitGoal = {
  id: string;
  asked: string;
  conceptId: string | null;
  status: string;
  unitId: string | null;
};

export type UnitState = 'not-opened' | 'in-progress' | 'done';

export type UnitRow<U> = {
  unit: U;
  goals: UnitGoal[];
  state: UnitState;
  /** Ideas still to learn across the unit's goals, each counted once. */
  left: number;
  next: boolean;
};

/** The goals the page draws a chain for: named, not abandoned, resolved to an idea. */
function live(goal: UnitGoal): boolean {
  return goal.status !== 'abandoned' && goal.conceptId !== null;
}

export function curriculumRows<U extends { id: string }>(
  units: U[],
  goals: UnitGoal[],
  graph: Graph,
): { rows: UnitRow<U>[]; outside: UnitGoal[] } {
  const known = new Set(units.map((unit) => unit.id));
  const rows: UnitRow<U>[] = units.map((unit) => {
    const mine = goals.filter((goal) => goal.unitId === unit.id && live(goal));
    const left = new Set(mine.flatMap((goal) => pruneForGoal(graph, goal.conceptId!))).size;
    const state: UnitState = mine.length === 0 ? 'not-opened' : left === 0 ? 'done' : 'in-progress';
    return { unit, goals: mine, state, left, next: false };
  });
  const next = rows.find((row) => row.state !== 'done');
  if (next) next.next = true;

  const outside = goals.filter(
    (goal) => live(goal) && (goal.unitId === null || !known.has(goal.unitId)),
  );
  return { rows, outside };
}
