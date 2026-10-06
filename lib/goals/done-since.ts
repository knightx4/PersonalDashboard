/**
 * What Dash did since your last visit, for the Goals home (plan #1076).
 *
 * One list, newest run first, of three kinds of line:
 *
 * - `result`: something a run produced for you to read, the result or draft
 *   stored on a step (items.result, items.result_url). It opens on the step,
 *   where the result is shown and marked read. When the run that stored it
 *   also closed the step, the line carries that change's undo, which puts
 *   the step back as it was and clears the result.
 * - `change`: any other change a run made to the map, as the run's page
 *   words it (lib/goals/run-changes.ts), with its undo state. Undo on the home
 *   is the run page's undo (undoRunChangeAction), so an undone line reads as
 *   undone here and there alike.
 * - `failed`: a run that failed, and why.
 *
 * A result from before this window that you have not read yet stays at the
 * end of the list until you read it, so a result is never lost by visiting
 * without opening it. Only a `claude` step's result is marked read (0007); a
 * draft on your own step (0023) is listed while its run is in the window.
 *
 * The window starts at the visit before this sitting
 * (goals.visits.previous_visit_at, lib/goals/catch-up.ts), so a press on the
 * home that reloads it keeps the list, and the next sitting clears it. After
 * five or more days away that visit is the one before the time away, so the
 * same list is the catch-up's.
 *
 * Pure. The reads are in lib/goals/done-since-store.ts.
 */
import type { ChangeLine, UndoState } from '@/lib/goals/run-changes';
import type { RunListing } from '@/lib/goals/runs';
import { JOB_LABELS } from '@/lib/goals/runs';
import { stepHref } from '@/lib/goals/all-goals';

/** The most change lines the list shows; the rest are on each run's page. Results are never capped. */
export const DONE_CHANGES_SHOWN = 10;

/** The goal a run or a step sits under. */
export type DoneGoal = { id: string; title: string };

/** A run in the window, with its change lines and the goal it was on. */
export type DoneRun = {
  run: RunListing;
  lines: readonly ChangeLine[];
  goal: DoneGoal | null;
};

/** A step that carries a result, as it stands now. */
export type ResultStep = {
  id: string;
  title: string;
  kind: string;
  /** Whether a result or a link to one is on the step now; false once undone. */
  hasResult: boolean;
  reviewedAt: string | null;
  /** When the step last changed, to order the unread results from before the window. */
  updatedAt: string;
  goal: DoneGoal | null;
};

/** The undo a line carries: the run page's line, by run and key. */
export type DoneUndo = { runId: string; key: string; state: UndoState; reason: string | null };

export type DoneItem =
  | {
      kind: 'result';
      /** The step's id. */
      id: string;
      title: string;
      goalId: string | null;
      goalTitle: string | null;
      /** The step on its goal's page, where the result is read. */
      href: string;
      /** A `claude` step's result you have not marked read. */
      unread: boolean;
      /** The run that stored it, or null for an unread result from before the window. */
      runId: string | null;
      undo: DoneUndo | null;
      /** ISO instant the run ended, or the step last changed. */
      at: string;
    }
  | {
      kind: 'change';
      /** `${runId}:${key}`, unique across the list. */
      id: string;
      sentence: string;
      goalId: string | null;
      goalTitle: string | null;
      /** The goal the run was on, or the run's own page. */
      href: string;
      undo: DoneUndo;
      at: string;
    }
  | {
      kind: 'failed';
      /** The run's id. */
      id: string;
      title: string;
      error: string;
      goalId: string | null;
      goalTitle: string | null;
      href: string;
      at: string;
    };

export type DoneSince = {
  /** ISO instant of the visit before this sitting. */
  since: string;
  items: DoneItem[];
  /** Change lines left out by the cap, which each run's page lists. */
  more: number;
};

/** The columns whose change stores a result on a step. */
const RESULT_COLUMNS = ['result', 'result_url'];

/** The step a line stored a result on, or null when it did not. */
export function resultStepOf(line: ChangeLine): string | null {
  for (const target of line.targets) {
    if (
      target.kind === 'revert' &&
      target.table === 'items' &&
      RESULT_COLUMNS.some((column) => column in target.values)
    ) {
      return target.rowId;
    }
  }
  return null;
}

/** Whether every target of a line is a write to this one step. */
function onlyOn(line: ChangeLine, stepId: string): boolean {
  return (
    line.targets.length > 0 &&
    line.targets.every((t) => t.table === 'items' && t.rowId === stepId)
  );
}

function stepLink(goal: DoneGoal | null, stepId: string): string {
  return goal ? stepHref(goal.id, stepId) : '/goals/all';
}

function runHref(entry: DoneRun): string {
  const { run, goal } = entry;
  if (!goal) return `/goals/runs/${run.id}`;
  return run.item?.level === 'step' ? stepHref(goal.id, run.item.id) : `/goals/${goal.id}`;
}

function runTitle(run: RunListing): string {
  return run.item?.title ?? run.area?.name ?? JOB_LABELS[run.job];
}

/** Claude's lines that can be undone or say why not; lines with no undo at all are left to the run's page. */
function shownChange(line: ChangeLine): boolean {
  return line.actor === 'claude' && line.state !== 'none';
}

/**
 * The list. `runs` are those that ended after `since` (a run still going is
 * left for the next visit); `steps` are the steps a result line names, and
 * every unread result, keyed by id.
 */
export function doneSince(
  since: string,
  runs: readonly DoneRun[],
  steps: ReadonlyMap<string, ResultStep>,
): DoneSince {
  const from = Date.parse(since);
  const ended = runs
    .filter(
      ({ run }) =>
        run.status !== 'started' && run.endedAt !== null && Date.parse(run.endedAt) > from,
    )
    .sort((a, b) => Date.parse(b.run.endedAt as string) - Date.parse(a.run.endedAt as string));

  const items: DoneItem[] = [];
  const listed = new Set<string>();
  let changesShown = 0;
  let more = 0;

  for (const entry of ended) {
    const { run, goal } = entry;
    const at = run.endedAt as string;
    if (run.status === 'failed') {
      items.push({
        kind: 'failed',
        id: run.id,
        title: runTitle(run),
        error: run.error ?? 'No reason was recorded.',
        goalId: goal?.id ?? null,
        goalTitle: goal?.title ?? null,
        href: runHref(entry),
        at,
      });
    }

    // The last line that stored each result carries the result's undo; the
    // run's other writes to that step (starting it, say) fold into it.
    const resultLines = new Map<string, ChangeLine>();
    for (const line of entry.lines) {
      const stepId = resultStepOf(line);
      if (stepId && line.actor === 'claude') resultLines.set(stepId, line);
    }

    for (const [stepId, line] of resultLines) {
      if (listed.has(stepId)) continue;
      const step = steps.get(stepId);
      // A step since deleted or archived has nothing left to read.
      if (!step) continue;
      listed.add(stepId);
      const stepGoal = step.goal ?? goal;
      items.push({
        kind: 'result',
        id: stepId,
        title: step.title,
        goalId: stepGoal?.id ?? null,
        goalTitle: stepGoal?.title ?? null,
        href: stepLink(stepGoal, stepId),
        unread: step.hasResult && step.kind === 'claude' && step.reviewedAt === null,
        runId: run.id,
        undo:
          line.state === 'none'
            ? null
            : { runId: run.id, key: line.key, state: line.state, reason: line.reason },
        at,
      });
    }

    for (const line of entry.lines) {
      if (!shownChange(line)) continue;
      if ([...resultLines.keys()].some((stepId) => onlyOn(line, stepId))) continue;
      if (changesShown >= DONE_CHANGES_SHOWN) {
        more += 1;
        continue;
      }
      changesShown += 1;
      items.push({
        kind: 'change',
        id: `${run.id}:${line.key}`,
        sentence: line.sentence,
        goalId: goal?.id ?? null,
        goalTitle: goal?.title ?? null,
        href: runHref(entry),
        undo: { runId: run.id, key: line.key, state: line.state, reason: line.reason },
        at,
      });
    }
  }

  // Results from before the window that are still unread, newest first.
  const unread = [...steps.values()]
    .filter(
      (step) =>
        !listed.has(step.id) && step.hasResult && step.kind === 'claude' && step.reviewedAt === null,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const step of unread) {
    items.push({
      kind: 'result',
      id: step.id,
      title: step.title,
      goalId: step.goal?.id ?? null,
      goalTitle: step.goal?.title ?? null,
      href: stepLink(step.goal, step.id),
      unread: true,
      runId: null,
      undo: null,
      at: step.updatedAt,
    });
  }

  return { since, items, more };
}
