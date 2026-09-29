import { areaRunView, type GoalRun } from '@/lib/goals/shaping';

/** How long a finished run stays in the list at the top of a goal. */
export const FINISHED_SHOWN_MS = 24 * 60 * 60 * 1000;

export type DashWorkItem = {
  stepId: string;
  title: string;
  runId: string;
  state: 'running' | 'finished';
  /** Where a running one has got to, or the first line of what a finished one did. */
  line: string | null;
};

/**
 * What Dash is on under one goal, and what it finished in the last day, for
 * the list at the top of the goal page (note 03ce0cce). A run sent from a
 * step's own button only showed on that step's row, which is usually folded,
 * so work started that way could not be seen from the top of the page.
 */
export function dashWork(
  runs: Record<string, GoalRun>,
  titles: ReadonlyMap<string, string>,
  now: number,
): DashWorkItem[] {
  const items: { item: DashWorkItem; at: number }[] = [];
  for (const [stepId, run] of Object.entries(runs)) {
    const title = titles.get(stepId);
    if (!title) continue;
    const view = areaRunView(run, now);
    if (view.running) {
      items.push({ item: { stepId, title, runId: run.id, state: 'running', line: view.running }, at: Date.parse(run.createdAt) });
      continue;
    }
    const ended = run.endedAt ? Date.parse(run.endedAt) : Number.NaN;
    if (run.status === 'done' && Number.isFinite(ended) && now - ended < FINISHED_SHOWN_MS) {
      items.push({ item: { stepId, title, runId: run.id, state: 'finished', line: view.summary }, at: ended });
    }
  }
  // Running first, then the most recently finished.
  items.sort((a, b) =>
    a.item.state === b.item.state ? b.at - a.at : a.item.state === 'running' ? -1 : 1,
  );
  return items.map(({ item }) => item);
}
