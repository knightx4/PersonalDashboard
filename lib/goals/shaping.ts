/**
 * Claude shaping a goal, and approving what it proposed (docs/GOALS-SPEC.md,
 * "Fog and refining a goal" and "Approval"; plan #932).
 *
 * "Work on this" on a goal fires the goals routine for that goal. The session
 * follows .claude/skills/goals: it maps the whole path for the goal (phases,
 * Claude steps, information steps pre-filled from Gmail, provisional steps,
 * questions with lettered options), proposed until you approve the goal;
 * after that it may add, split and reorder steps beneath it without asking. The database holds it to that
 * (supabase/migrations-goals/0006).
 *
 * The rules that need no database live here: what a run looks like on the
 * page, how many proposals are waiting, and the brief the routine is fired
 * with. The reads and writes are in lib/goals/shaping-store.ts.
 */
import type { StepNode } from '@/lib/goals/steps';

export type GoalRunStatus = 'started' | 'done' | 'failed';

/** One goals.runs row, as the goal page needs it. */
export type GoalRun = {
  id: string;
  status: GoalRunStatus;
  /** ISO instant. */
  createdAt: string;
  endedAt: string | null;
  summary: string | null;
  error: string | null;
};

/**
 * How long a started run is taken to still be working. A session that dies
 * never writes its row back, so past this the page stops saying Claude is on
 * it and lets you press again. The same two hours the dev plan uses.
 */
export const RUN_QUIET_MS = 2 * 60 * 60 * 1000;

/** Whether a run is still taken to be going, so a second press is refused. */
export function runInFlight(run: GoalRun | null, now: number): boolean {
  if (!run || run.status !== 'started') return false;
  return now - Date.parse(run.createdAt) < RUN_QUIET_MS;
}

/** Every proposed step anywhere in the tree, which approving opens. */
export function countProposed(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === 'proposed') count += 1;
    count += countProposed(node.children);
  }
  return count;
}

/**
 * Whether a question is waiting on you: open, unanswered and not put aside
 * with Not now (plan #956).
 */
export function awaitsAnswer(node: StepNode): boolean {
  return (
    node.kind === 'decision' &&
    node.status === 'open' &&
    node.resolution === null &&
    !node.dismissedAt
  );
}

/** Open questions with no answer yet and not put aside, anywhere in the tree. */
export function countOpenQuestions(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (awaitsAnswer(node)) count += 1;
    count += countOpenQuestions(node.children);
  }
  return count;
}

/** Questions put aside with Not now and not answered since, anywhere in the tree. */
export function countAside(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'decision' && node.resolution === null && node.dismissedAt) count += 1;
    count += countAside(node.children);
  }
  return count;
}

/** The first line of a summary, short enough for one line on the page. */
function firstLine(text: string, max = 160): string {
  const line = text.trim().split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * What the page says about the latest run on a goal, or null when there has
 * never been one. `when` formats an instant for the reader's clock.
 */
export function runLine(
  run: GoalRun | null,
  now: number,
  when: (iso: string) => string,
): string | null {
  if (!run) return null;
  if (run.status === 'failed') {
    return `The last run did not start or did not finish: ${firstLine(run.error ?? 'no reason given')}`;
  }
  if (run.status === 'done') {
    const at = when(run.endedAt ?? run.createdAt);
    return run.summary ? `Claude worked on this ${at}: ${firstLine(run.summary)}` : `Claude worked on this ${at}.`;
  }
  if (runInFlight(run, now)) return `Claude is working on this, started ${when(run.createdAt)}.`;
  return `A run started ${when(run.createdAt)} and never reported back.`;
}

/** One goals.history row written under a run, as runChanges reads it. */
export type RunHistoryRow = {
  table_name: string;
  action: string;
  row_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

/** What a run changed, counted from the history rows that carry its id. */
export type RunChanges = {
  stepsAdded: number;
  questionsAsked: number;
  formsFilled: number;
  stepsDone: number;
};

/**
 * Count what a run did (plan #961). A step or question is one inserted item
 * row; a form filled is each record the run added or changed, counted once
 * however many times it was written; a step done is an item whose status
 * moved to done. History keeps the whole row on an insert and only the
 * changed columns on an update, which is why the update is read from
 * old_values and new_values together.
 */
export function runChanges(rows: readonly RunHistoryRow[]): RunChanges {
  const changes: RunChanges = { stepsAdded: 0, questionsAsked: 0, formsFilled: 0, stepsDone: 0 };
  const records = new Set<string>();
  for (const row of rows) {
    if (row.table_name === 'items') {
      if (row.action === 'insert' && row.new_values?.level === 'step') {
        if (row.new_values.kind === 'decision') changes.questionsAsked += 1;
        else changes.stepsAdded += 1;
        if (row.new_values.status === 'done') changes.stepsDone += 1;
      } else if (
        row.action === 'update' &&
        row.new_values?.status === 'done' &&
        row.old_values?.status !== 'done'
      ) {
        changes.stepsDone += 1;
      }
    } else if (row.table_name === 'records' && (row.action === 'insert' || row.action === 'update')) {
      records.add(row.row_id);
    }
  }
  changes.formsFilled = records.size;
  return changes;
}

function counted(count: number, one: string, many: string): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The counts as one sentence, or a sentence saying there were none. Null
 * when there is no history to count, so nothing is claimed either way.
 */
export function changesLine(changes: RunChanges | null): string | null {
  if (!changes) return null;
  const parts = [
    counted(changes.stepsAdded, 'step added', 'steps added'),
    counted(changes.questionsAsked, 'question asked', 'questions asked'),
    counted(changes.formsFilled, 'form filled', 'forms filled'),
    counted(changes.stepsDone, 'step done', 'steps done'),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return 'It left the steps and forms as they were.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `What it changed: ${list}.`;
}

/**
 * The turn appended to the goals routine's standing prompt when "Work on
 * this" is pressed. It names the goal, the account and the run row the app
 * already wrote, so the session labels every change with that run and closes
 * the row when it stops.
 */
export function goalRunText(input: {
  goalId: string;
  goalTitle: string;
  userId: string;
  runId: string;
}): string {
  return [
    `Work on one goal: "${input.goalTitle}" (goals.items id ${input.goalId}).`,
    '',
    'Follow .claude/skills/goals/SKILL.md. Read it first: it says how to map the whole path',
    'for a goal (phases, Claude steps, information steps pre-filled from Gmail, provisional',
    'steps, questions with lettered options), what you may change before and after the goal',
    'is approved, and how every write is labelled.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}

/**
 * What the goal page says about approval, and what its button is called, or
 * null for no button. Approving opens the goal if Claude proposed it and every
 * proposed step under it, and from then on Claude may add, split and reorder
 * steps beneath it without asking.
 *
 * An approved goal with nothing proposed says only what questions are waiting,
 * or nothing: what approval allows was said when it was asked for, and saying
 * it on every visit after is furniture (ui finding 133242ff, plan #1038).
 */
export function approvalLine(input: {
  goalStatus: 'proposed' | 'open' | 'done' | 'dropped';
  approvedAt: string | null;
  proposed: number;
  questions: number;
}): { text: string; approve: string | null } {
  const steps = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;
  const asks =
    input.questions === 0
      ? ''
      : ` ${input.questions === 1 ? 'One question' : `${input.questions} questions`} for you ${input.questions === 1 ? 'is' : 'are'} in the steps below.`;

  if (input.goalStatus === 'proposed') {
    return {
      text: `Claude proposed this goal${input.proposed > 0 ? ` and ${steps(input.proposed)} under it` : ''}. Approving adds it to your goals.${asks}`,
      approve: 'Approve goal',
    };
  }
  if (input.approvedAt === null) {
    return {
      text:
        (input.proposed > 0
          ? `Claude proposed ${steps(input.proposed)}. Approving makes them live and lets Claude add and reorder steps here without asking.`
          : 'Not approved yet, so anything Claude adds here waits for you. Approving lets it add and reorder steps without asking.') +
        asks,
      approve: input.proposed > 0 ? 'Approve breakdown' : 'Approve goal',
    };
  }
  if (input.proposed > 0) {
    return {
      text: `${steps(input.proposed)} proposed since you approved this goal.${asks}`,
      approve: input.proposed === 1 ? 'Approve it' : 'Approve them',
    };
  }
  return { text: asks.trim(), approve: null };
}
