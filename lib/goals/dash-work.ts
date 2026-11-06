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
  /** Where its title links, when not to its step's row: a question's result (plan #2778.8). */
  href?: string;
};

/** A question handed to the goal that ended (plan #2778.8), as its result on the Dashboard. */
export type QuestionResult = {
  runId: string;
  question: string;
  state: 'done' | 'failed';
  /** What Dash wrote when it closed the run: the answer first. */
  text: string | null;
};

/**
 * The questions handed to a goal (plan #2778.8): those still running, as
 * lines of Dash's work with the question as the title, and those ended in
 * the last day or named by the link, as results. The run the link names is
 * shown however long ago it ended.
 */
export function questionWork(
  runs: readonly (GoalRun & { question: string })[],
  goalId: string,
  now: number,
  named?: string | null,
): { running: DashWorkItem[]; finished: DashWorkItem[]; results: QuestionResult[] } {
  const running: DashWorkItem[] = [];
  const finished: DashWorkItem[] = [];
  const results: QuestionResult[] = [];
  for (const run of runs) {
    const view = areaRunView(run, now);
    const href = `/goals/${goalId}?work=${run.id}#work-${run.id}`;
    if (view.running) {
      running.push({ stepId: goalId, title: run.question, runId: run.id, state: 'running', line: view.running, href });
      continue;
    }
    const ended = run.endedAt ? Date.parse(run.endedAt) : Number.NaN;
    const recent = Number.isFinite(ended) && now - ended < FINISHED_SHOWN_MS;
    if (run.status !== 'done' && run.status !== 'failed') continue;
    if (!recent && run.id !== named) continue;
    results.push({
      runId: run.id,
      question: run.question,
      state: run.status,
      text: run.status === 'done' ? run.summary : run.error,
    });
    if (run.status === 'done' && recent) {
      finished.push({ stepId: goalId, title: run.question, runId: run.id, state: 'finished', line: view.summary, href });
    }
  }
  // The one the link names first, then the newest.
  results.sort((a, b) => (a.runId === named ? -1 : b.runId === named ? 1 : 0));
  return { running, finished, results };
}

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
