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
 * Only the steps that are on you are moved, by the rule Today ranks them by
 * (lib/goals/today.ts): a step with a date, one on Todo, one that frees
 * another, and the first plain step of each goal. The plain steps after it
 * are the goal's backlog, which is meant to sit, and moving each of them
 * filled the Inbox with a question per backlog step, 31 on one goal in
 * October 2026. A goal with a step already waiting on an open question has
 * had its ask: its plain steps get no move until the answer comes.
 *
 * A goal at rest gets no moves at all (`resting`): one offered for parking,
 * where the park row on the Inbox is the one question about it, and one
 * whose question went unanswered lately (RESTING_AFTER_DEFAULT_DAYS), which
 * the person has just said nothing to.
 *
 * Pure. The reads are in lib/goals/stale-steps-store.ts.
 */
import { waitsOnNothing } from '@/lib/goals/dependencies';
import type { StepNode } from '@/lib/goals/steps';
import { unblockedBy } from '@/lib/goals/today';
import type { Goal } from '@/lib/goals/tree';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A step of yours untouched this many days gets a move from the morning run. */
export const STALE_AFTER_DAYS = 7;

/** How long a goal is left alone after one of its questions closed unanswered. */
export const RESTING_AFTER_DEFAULT_DAYS = 21;

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

/** Every step in these trees by id. */
function index(stepsByGoal: Map<string, StepNode[]>): Map<string, StepNode> {
  const nodes = new Map<string, StepNode>();
  const walk = (list: StepNode[]) => {
    for (const node of list) {
      nodes.set(node.id, node);
      walk(node.children);
    }
  };
  for (const roots of stepsByGoal.values()) walk(roots);
  return nodes;
}

/** Whether a step waits on a question still open: one the run (or anyone) asked beside it. */
function waitsOnAQuestion(node: StepNode, nodes: ReadonlyMap<string, StepNode>): boolean {
  return (node.dependsOn ?? []).some((link) => {
    const q = nodes.get(link.item.id);
    return q?.kind === 'decision' && q.status === 'open' && q.resolution === null && !q.dismissedAt;
  });
}

/**
 * Every step of yours that is on you and has sat for STALE_AFTER_DAYS or
 * more, longest first. `underWay` holds the steps with a progress entry,
 * which are left out, and `resting` the goals left alone (see above).
 */
export function staleSteps(
  goals: Goal[],
  stepsByGoal: Map<string, StepNode[]>,
  touched: Map<string, number>,
  now: number,
  underWay: ReadonlySet<string> = new Set(),
  resting: ReadonlySet<string> = new Set(),
): StaleStep[] {
  const nodes = index(stepsByGoal);
  const stale: StaleStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open' || resting.has(goal.id)) continue;
    const roots = stepsByGoal.get(goal.id) ?? [];
    const askedAlready = (list: StepNode[]): boolean =>
      list.some(
        (node) =>
          (node.kind === 'mine' && node.status === 'open' && waitsOnAQuestion(node, nodes)) ||
          askedAlready(node.children),
      );
    // A question already waiting on the person under this goal takes the plain step's turn.
    let plainTaken = askedAlready(roots);
    const walk = (list: StepNode[]) => {
      for (const node of list) {
        if (node.status !== 'open') continue;
        if (node.waitsUntil) continue;
        if (node.kind === 'mine' && waitsOnNothing(node)) {
          const plain = !node.dueOn && !node.onTodo && unblockedBy(node, nodes) === 0;
          const onYou = !plain || !plainTaken;
          if (plain) plainTaken = true;
          const last = onYou && !underWay.has(node.id) ? branchTouched(node, touched) : null;
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
    walk(roots);
  }
  return stale.sort((a, b) => b.idleDays - a.idleDays);
}

/**
 * The goals whose questions closed unanswered (goals.items.defaulted_at) in
 * the last RESTING_AFTER_DEFAULT_DAYS, from the ids and times of those
 * questions, found in the trees by id.
 */
export function restingAfterDefault(
  stepsByGoal: Map<string, StepNode[]>,
  defaulted: readonly { id: string; defaultedAt: string }[],
  now: number,
): Set<string> {
  const recent = new Set(
    defaulted
      .filter((q) => now - Date.parse(q.defaultedAt) < RESTING_AFTER_DEFAULT_DAYS * DAY_MS)
      .map((q) => q.id),
  );
  const out = new Set<string>();
  if (recent.size === 0) return out;
  const holds = (list: StepNode[]): boolean =>
    list.some((node) => recent.has(node.id) || holds(node.children));
  for (const [goalId, roots] of stepsByGoal) if (holds(roots)) out.add(goalId);
  return out;
}

/**
 * The open questions waiting on the person across every goal, as the cap in
 * goals.cap_open_questions (migrations-goals/0088) counts them.
 */
export function openQuestionCount(stepsByGoal: Map<string, StepNode[]>): number {
  let count = 0;
  const walk = (list: StepNode[]) => {
    for (const node of list) {
      if (node.kind === 'decision' && node.status === 'open' && node.resolution === null && !node.dismissedAt) {
        count += 1;
      }
      walk(node.children);
    }
  };
  for (const roots of stepsByGoal.values()) walk(roots);
  return count;
}

/** The most open questions the Inbox holds, as goals.open_question_cap() says. */
export const OPEN_QUESTION_CAP = 5;

/** One step's line in the morning brief. */
export function staleLine(step: StaleStep): string {
  return (
    `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}": ` +
    `untouched ${step.idleDays} days` +
    (step.prepared ? ', already prepared once' : '')
  );
}
