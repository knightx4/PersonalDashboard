/**
 * What the overnight runner should do on this tick: fire one feature, or stop.
 *
 * The tick has two halves to read and they are kept apart. `overnight.ts`
 * answers the row -- is the runner on, has the budget gone, has the clock gone,
 * is it held -- and knows nothing about the plan. This answers the plan -- is
 * there anything left that Claude could pick up, and which feature is it under
 * -- and knows nothing about the database. `chooseOvernightFeature` is the two
 * of them composed, so the tick route asks one question and gets one answer.
 *
 * The choice itself is the one a person would make standing at the plan: the
 * most urgent thing that is ready and the runner may take, and the feature it
 * belongs to. `runnerOrder(sections)` is
 * already exactly that list -- ready steps only, decisions and dismissed rows
 * out, priority then reading order -- and `isReady` has already dropped
 * anything blocked, waiting on an open dependency, or sitting under a blocked,
 * dropped or proposed parent. Steps under an overhaul are left out too, since
 * an overhaul is worked by its own routine. So there is nothing to re-derive here: the answer
 * is the feature above the first row that comes back, and a feature that is
 * itself that row is its own answer.
 *
 * Which is also why the "never names a feature with no ready step beneath it"
 * rule holds by construction rather than by a second check. The feature is
 * named *from* a ready step, never looked up and then checked -- there is no
 * path through this file that reaches a feature any other way.
 *
 * Pure, and no database at all. The tick loads the row and builds the tree; a
 * page could call this with the same two things to say what the runner will do
 * next without firing anything.
 */
import { overnightVerdict, type OvernightRun } from './overnight';
import { isClosed, isDismissed } from './load';
import { ancestorsOf, flatten, topFeatureOf, workOrder, type PlanNode, type PlanSection } from './tree';

/**
 * Whether a row is an overhaul or sits beneath one.
 *
 * An overhaul (docs/SPEC-LAYER-SPEC.md Part 4) has one owner, its own
 * routine, which builds it in its own order: design first, then three
 * phases, each reviewed against the design before it merges. A step of it
 * fired by the runner as an ordinary feature would skip all of that. The
 * track is read on the feature, but any overhaul above the row counts, so a
 * sub-feature of one is skipped too.
 */
export function isUnderOverhaul(sections: readonly PlanSection[], node: PlanNode): boolean {
  if (node.track === 'overhaul') return true;
  return ancestorsOf(sections, node.id).some((above) => above.track === 'overhaul');
}

/**
 * What the runner may take, in the order it takes it: `workOrder`'s runner
 * list less every step under an overhaul.
 *
 * Here rather than in `workOrder`, because `next --claude` reads that list
 * too, and the overhaul routine working its own feature needs its steps to
 * stay in it. The runner is the one reader that must never see them.
 */
export function runnerOrder(sections: readonly PlanSection[]): PlanNode[] {
  return workOrder(sections, { only: 'runner' }).filter(
    (step) => !isUnderOverhaul(sections, step) && !isFinishedFeature(step),
  );
}

/**
 * A feature whose work is all done but which nobody closed: it has steps,
 * every one not put aside is closed, at least one of them is done, and the
 * feature itself is still open.
 *
 * `isReady` counts such a feature as ready, since nothing beneath it is open,
 * so the runner used to send it. On 1 and 2 November #2644 and #2667, both in
 * a project whose sessions close steps one at a time, were sent again a
 * minute after their last step closed. Each session found nothing to build
 * and ended failed, the feature stayed open, and every feature waiting on it
 * (#2650, #2656, #2661 and #2671) stayed waiting. Such a feature is closed by
 * the tick (`finishedFeatures`) and never sent.
 *
 * A feature whose steps were all dropped is left alone: none of its work
 * shipped, so it is not finished, and it is the person's to close or re-shape.
 */
export function isFinishedFeature(
  node: Pick<PlanNode, 'status' | 'dismissedAt'> & {
    children: readonly Pick<PlanNode, 'status' | 'dismissedAt'>[];
  },
): boolean {
  if (node.status !== 'not_started' && node.status !== 'in_progress') return false;
  if (isDismissed(node)) return false;
  const steps = node.children.filter((child) => !isDismissed(child));
  if (steps.length === 0) return false;
  return steps.every((child) => isClosed(child.status)) && steps.some((child) => child.status === 'done');
}

/** A finished feature to close, with the commit its newest done step carries. */
export type FinishedFeature = {
  id: string;
  number: number;
  outline: string;
  comment: string | null;
  /** The commit of the step that closed last, or null when none carries one. */
  commitSha: string | null;
};

/**
 * Every feature in the tree that `isFinishedFeature` says is done in all but
 * name, deepest first, so a sub-feature is closed before the feature above it
 * is judged on the next tick.
 */
export function finishedFeatures(sections: readonly PlanSection[]): FinishedFeature[] {
  const nodes = sections.flatMap((section) => flatten(section.nodes));
  return nodes
    .filter((node) => isFinishedFeature(node))
    .sort((a, b) => b.depth - a.depth)
    .map((node) => {
      const newest = node.children
        .filter((child) => child.status === 'done' && child.commitSha)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
      return {
        id: node.id,
        number: node.number,
        outline: node.outline,
        comment: node.comment,
        commitSha: newest?.commitSha ?? null,
      };
    });
}

/** The line a feature closed this way carries in its history. */
export function finishedFeatureLine(day: string): string {
  return `Done ${day}: every step beneath it is done, so the overnight runner closed it.`;
}

/**
 * The night ran out of work rather than out of budget or clock.
 *
 * A sentence, like every other `ended_reason`, because the morning report
 * prints it verbatim. It says "handed to Dash" rather than "ready" because
 * that is the part a person can do something about in the morning: the plan
 * may be full of work, and none of it assigned over.
 */
export const OVERNIGHT_NOTHING_READY =
  'Nothing handed to Dash was ready to build, so it stopped early.';

/**
 * What the tick should do now.
 *
 * `fire` carries both rows: the feature is what gets sent, and `step` is the
 * ready step it was chosen from -- the evidence for the choice, and what to say
 * in a log line when a night is read back later. `end` carries the sentence to
 * close the night with. `idle` and `paused` mean leave the row exactly as it
 * is: there is no night, or it is being held.
 */
export type OvernightChoice =
  | { act: 'idle' }
  | { act: 'paused' }
  | { act: 'end'; reason: string }
  | { act: 'fire'; feature: PlanNode; step: PlanNode };

/**
 * The feature to fire next, or the reason there is not one.
 *
 * The row is read first and the plan second, because the row's answers are the
 * cheap ones and three of the four stop the tick before the tree matters. A
 * night that is over is over whether or not there is work left, and the reason
 * written on it should be the one that ended it -- so "nothing was ready" is
 * only ever reached by a night that could otherwise have fired.
 *
 * `now` is the tick's real clock, the same one `overnightVerdict` takes.
 *
 * Liveness is deliberately not folded in. Whether the running features'
 * sessions are still working is a different question, answered from GitHub by
 * `readRunLiveness` in `lib/plan/liveness.ts`, and the caller checks it before
 * asking this: how many run at once, and in which modules, is the tick's rule,
 * not the chooser's, and a chooser that reached for the network would stop
 * being pure.
 */
export function chooseOvernightFeature(
  sections: readonly PlanSection[],
  run: OvernightRun | null,
  now: number,
): OvernightChoice {
  const verdict = overnightVerdict(run, now);
  if (verdict.act !== 'fire') return verdict;

  const step = runnerOrder(sections)[0];
  if (!step) return { act: 'end', reason: OVERNIGHT_NOTHING_READY };

  return { act: 'fire', feature: topFeatureOf(sections, step), step };
}

/**
 * How many features the runner could actually pick up right now.
 *
 * The card above the plan used to say only what a night had spent and what it
 * was on, which answers "is it working" but not "is there anything for it to
 * work". Those are different questions on this plan: the budget can have four
 * features left in it and the tree nothing ready for the runner to take, and
 * the night then ends on its next tick with `OVERNIGHT_NOTHING_READY`.
 *
 * Counted the way the chooser chooses, not by a second reading of the tree:
 * every ready step the runner may take, folded up to the feature that would be
 * fired for it. So a feature with six ready steps beneath it counts once --
 * which is the whole of the ask, because the runner fires features and the
 * budget is spent in features.
 *
 * Pure, and it takes no run row: what is ready is a fact about the plan and
 * true whether or not a night is on. A night that is held or over still has
 * this many features waiting for the next one.
 */
export function readyFeatureCount(sections: readonly PlanSection[]): number {
  const features = new Set<string>();
  for (const step of runnerOrder(sections)) {
    features.add(topFeatureOf(sections, step).id);
  }
  return features.size;
}

/**
 * The same count as the sentence the card prints.
 *
 * Here rather than in the component so the page and a test agree on the words,
 * and so the zero reads as a state rather than as a number with a noun after
 * it: "no features are ready" is the thing worth noticing on a card whose
 * night is about to stop early.
 *
 * `steps`, when given, adds how many ready steps sit beneath those features,
 * which is how much work a started run has in front of it.
 */
export function readyFeaturesLine(count: number, steps?: number): string {
  if (count === 0) return 'no features ready';
  const features = count === 1 ? '1 feature ready' : `${count} features ready`;
  if (!steps) return features;
  return `${features} · ${steps === 1 ? '1 step' : `${steps} steps`}`;
}
