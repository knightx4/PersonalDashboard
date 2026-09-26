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
 * belongs to. `workOrder(sections, { only: 'runner' })` is
 * already exactly that list -- ready steps only, decisions and dismissed rows
 * out, priority then reading order -- and `isReady` has already dropped
 * anything blocked, waiting on an open dependency, or sitting under a blocked,
 * dropped or proposed parent. So there is nothing to re-derive here: the answer
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
import { topFeatureOf, workOrder, type PlanNode, type PlanSection } from './tree';

/**
 * The night ran out of work rather than out of budget or clock.
 *
 * A sentence, like every other `ended_reason`, because the morning report
 * prints it verbatim. It says "handed to Claude" rather than "ready" because
 * that is the part a person can do something about in the morning: the plan
 * may be full of work, and none of it assigned over.
 */
export const OVERNIGHT_NOTHING_READY =
  'Nothing handed to Claude was ready to build, so it stopped early.';

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

  const step = workOrder(sections, { only: 'runner' })[0];
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
  for (const step of workOrder(sections, { only: 'runner' })) {
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
