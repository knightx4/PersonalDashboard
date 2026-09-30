/**
 * Which goal steps are on Todo (docs/GOALS-SPEC.md, "Todo"; plans #927 and
 * #1266).
 *
 * Two ways in. Each open goal's next step of yours is on Todo with nothing
 * pressed: the first of the next steps the Goals home shows for it (dailyView
 * in lib/goals/daily.ts), so a parked goal, a step that waits on another and
 * a step for later put nothing there. And any step you pressed Show on Todo on
 * is there too, as below. A step that is both is listed once.
 * *
 * A step is on Todo while you have pressed Show on Todo on it and it is still
 * something to do: yours, open, and reachable through open steps from an open
 * goal. A step under a dropped branch or a goal you have not taken on yet
 * leaves Todo with it, the same way the Goals home leaves it out, and comes
 * back if that branch is reopened. A step whose start date has not come is
 * still listed, with that date, so Todo can hold it until the day. The flag itself is never cleared by this,
 * so reopening the step puts it back where you asked for it.
 *
 * Pure, so the rule is tested without a database. The reads are in
 * lib/goals/steps-store.ts and the agenda source that shows the result is
 * lib/todo/agenda/sources/goal-steps.ts.
 */
import { dailyView, type DailyView } from '@/lib/goals/daily';
import type { Step, StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

export type TodoStep = {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null for an undated step. */
  dueOn: string | null;
  /** The day it can start, when that is still ahead (StepNode.waitsUntil); null once it can. */
  startsOn: string | null;
  goalId: string;
  goalTitle: string;
  /**
   * Set when this is its goal's next step, which is on Todo without a press
   * and shows today when it has no date. Absent on a step only flagged.
   */
  next?: true;
};

/** Whether Show on Todo means anything for this step. */
export function canShowOnTodo(step: Pick<Step, 'kind' | 'status'>): boolean {
  return step.kind === 'mine' && step.status === 'open';
}

export function todoSteps(goals: Goal[], byGoal: Map<string, StepNode[]>): TodoStep[] {
  const out: TodoStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (node.onTodo && canShowOnTodo(node)) {
          out.push({
            id: node.id,
            title: node.title,
            dueOn: node.dueOn,
            startsOn: node.waitsUntil ?? null,
            goalId: goal.id,
            goalTitle: goal.title,
          });
        }
        walk(node.children);
      }
    };
    walk(byGoal.get(goal.id) ?? []);
  }
  return out;
}

/**
 * Everything Goals puts on Todo as steps: each open goal's next step of yours
 * (plan #1266) and the steps flagged with Show on Todo, one row per step.
 *
 * The pick is dailyView's first next item for the goal, so Todo and the Goals
 * home never disagree about what is next. dailyView blanks an overdue due
 * date for the home; here the step keeps its own, so Todo can show it late.
 */
export function goalTodoSteps(
  goals: { goal: Goal; areaName: string }[],
  byGoal: Map<string, StepNode[]>,
  today: string,
  view: DailyView = dailyView(goals, byGoal, today),
): TodoStep[] {
  const flagged = todoSteps(
    goals.map((g) => g.goal),
    byGoal,
  );
  const nodes = new Map<string, StepNode>();
  const index = (list: StepNode[]) => {
    for (const node of list) {
      nodes.set(node.id, node);
      index(node.children);
    }
  };
  for (const roots of byGoal.values()) index(roots);

  const picks = new Map<string, TodoStep>();
  for (const { goal, next } of view.goals) {
    const node = next[0] && nodes.get(next[0].id);
    if (!node) continue;
    picks.set(node.id, {
      id: node.id,
      title: node.title,
      dueOn: node.dueOn,
      startsOn: null,
      goalId: goal.id,
      goalTitle: goal.title,
      next: true,
    });
  }

  const out = flagged.map((step) => (picks.has(step.id) ? { ...step, next: true as const } : step));
  const listed = new Set(out.map((step) => step.id));
  for (const pick of picks.values()) if (!listed.has(pick.id)) out.push(pick);
  return out;
}

/**
 * A question Dash asked on a goal, for Todo to answer (plan #1267). The
 * options are read out of its detail by planOptions in lib/plan/options.ts,
 * where the Todo row does it, so a detail with no lettered set shows as a
 * link to the goal instead of buttons.
 */
export type TodoQuestion = {
  id: string;
  title: string;
  detail: string | null;
  goalId: string;
  goalTitle: string;
};

/**
 * The open questions the Goals home lists as waiting on you: unanswered, not
 * put aside, not under a step for later, on an open goal. They are dailyView's
 * `question` rows, so Todo and the Goals home ask the same questions.
 */
export function todoQuestions(view: DailyView, byGoal: Map<string, StepNode[]>): TodoQuestion[] {
  const details = new Map<string, string | null>();
  const index = (list: StepNode[]) => {
    for (const node of list) {
      if (node.kind === 'decision') details.set(node.id, node.detail);
      index(node.children);
    }
  };
  for (const roots of byGoal.values()) index(roots);

  return view.waiting.flatMap((row) =>
    row.kind === 'question'
      ? [
          {
            id: row.id,
            title: row.title,
            detail: details.get(row.id) ?? null,
            goalId: row.goalId,
            goalTitle: row.goalTitle,
          },
        ]
      : [],
  );
}

/**
 * Everything Goals puts on Todo from its trees, from one pass of dailyView:
 * the steps (goalTodoSteps) and Dash's open questions (todoQuestions).
 */
export function goalsForTodo(
  goals: { goal: Goal; areaName: string }[],
  byGoal: Map<string, StepNode[]>,
  today: string,
): { steps: TodoStep[]; questions: TodoQuestion[] } {
  const view = dailyView(goals, byGoal, today);
  return {
    steps: goalTodoSteps(goals, byGoal, today, view),
    questions: todoQuestions(view, byGoal),
  };
}
