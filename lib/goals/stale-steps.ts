/**
 * Steps of yours that have sat for a week (plan #1083).
 *
 * The morning run moves every open step of yours that nobody has touched in
 * seven days, so none goes eight without a move. It gets one of three moves,
 * chosen by the run (the goals skill, "Moving a step that has sat for a
 * week"): split into smaller sub-steps, prepared for you (a draft, a script,
 * instructions, stored on the step), or a question beside it asking whether
 * you still want it, which the step then waits on. Each move is a write the
 * run makes, so it is in the log on the Goals home with an undo.
 *
 * What counts as touched is anything that changes the step or its branch:
 * the step's own row changing (updated_at, which a prepare, an edit or a
 * reopen moves), a sub-step added or changed beneath it, a comment of yours
 * on it, and a progress entry logged on it that was not undone. Each of the
 * three moves touches the step by that measure: a prepare writes the step, a
 * split adds sub-steps beneath it, and a question makes it wait, which takes
 * it off this list until the answer.
 *
 * Which steps are listed: a step of yours (`mine`), open, under an open goal
 * and reached through open steps only, with nothing open beneath it and
 * nothing it waits on, and whose start date has come. A blocked step already
 * waits on something, and a rhythm repeats, so neither is listed. Nor is a
 * step under way, one with a progress entry: lib/goals/progress-nudges.ts
 * nudges it when nothing has been logged for a week, so it never gets both
 * moves.
 *
 * Pure. The reads are in lib/goals/stale-steps-store.ts.
 */
import { waitsOnNothing } from '@/lib/goals/dependencies';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A step of yours untouched this many days gets a move from the morning run. */
export const STALE_AFTER_DAYS = 7;

/** More than this many and the rest wait for tomorrow, so one run stays one sitting. */
export const STALE_STEP_LIMIT = 10;

export type StaleStep = {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  /** Whole days since anything touched the step or its branch. */
  idleDays: number;
  /** Whether it already carries something Dash prepared, so preparing it again is the weakest move. */
  prepared: boolean;
};

/** A step's own row, as the store reads it. */
export type TouchRow = { id: string; created_at: string | null; updated_at: string | null };

/** A comment of yours on a step. */
export type CommentTouch = { item_id: string | null; created_at: string | null };

/** A progress entry on a step, not undone. */
export type ProgressTouch = { item_id: string | null; created_at: string | null };

/**
 * When each step itself was last touched: its row changing, a comment of
 * yours on it, or a progress entry logged on it.
 */
export function touchTimes(
  items: TouchRow[],
  comments: CommentTouch[],
  progress: ProgressTouch[] = [],
): Map<string, number> {
  const touched = new Map<string, number>();
  const bump = (id: unknown, at: unknown) => {
    if (typeof id !== 'string' || typeof at !== 'string') return;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return;
    touched.set(id, Math.max(ms, touched.get(id) ?? 0));
  };
  for (const row of items) {
    bump(row.id, row.created_at);
    bump(row.id, row.updated_at);
  }
  for (const comment of comments) bump(comment.item_id, comment.created_at);
  for (const entry of progress) bump(entry.item_id, entry.created_at);
  return touched;
}

/**
 * The newest touch on a step or anything beneath it, or null when none of
 * them has a known time (a row the store did not read), which leaves the
 * step off the list rather than calling it untouched.
 */
function branchTouched(node: StepNode, touched: Map<string, number>): number | null {
  let latest = touched.get(node.id) ?? null;
  for (const child of node.children) {
    const below = branchTouched(child, touched);
    if (below !== null && (latest === null || below > latest)) latest = below;
  }
  return latest;
}

/**
 * Every step of yours that has sat for STALE_AFTER_DAYS or more, longest
 * first. `underWay` holds the steps with a progress entry, which are left out.
 */
export function staleSteps(
  goals: Goal[],
  stepsByGoal: Map<string, StepNode[]>,
  touched: Map<string, number>,
  now: number,
  underWay: ReadonlySet<string> = new Set(),
): StaleStep[] {
  const stale: StaleStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (node.waitsUntil) continue;
        if (node.kind === 'mine' && waitsOnNothing(node) && !underWay.has(node.id)) {
          const last = branchTouched(node, touched);
          if (last !== null) {
            const idleDays = Math.floor((now - last) / DAY_MS);
            if (idleDays >= STALE_AFTER_DAYS) {
              stale.push({
                id: node.id,
                title: node.title,
                goalId: goal.id,
                goalTitle: goal.title,
                idleDays,
                prepared: node.result !== null || node.resultUrl !== null,
              });
            }
          }
        }
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  return stale.sort((a, b) => b.idleDays - a.idleDays);
}

/** One step's line in the morning brief. */
export function staleLine(step: StaleStep): string {
  return (
    `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}": ` +
    `untouched ${step.idleDays} days` +
    (step.prepared ? ', already prepared once' : '')
  );
}
