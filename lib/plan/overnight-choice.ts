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
 * most urgent thing that is ready and has been handed to Claude, and the
 * feature it belongs to. `workOrder(sections, { assignee: 'claude' })` is
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
 * Liveness is deliberately not folded in. Whether the *last* feature's session
 * is still working is a different question, answered from GitHub by
 * `readRunLiveness` in `lib/plan/liveness.ts`, and the caller checks it before
 * asking this: one feature at a time is the tick's rule, not the chooser's, and
 * a chooser that reached for the network would stop being pure.
 */
export function chooseOvernightFeature(
  sections: readonly PlanSection[],
  run: OvernightRun | null,
  now: number,
): OvernightChoice {
  const verdict = overnightVerdict(run, now);
  if (verdict.act !== 'fire') return verdict;

  const step = workOrder(sections, { assignee: 'claude' })[0];
  if (!step) return { act: 'end', reason: OVERNIGHT_NOTHING_READY };

  return { act: 'fire', feature: topFeatureOf(sections, step), step };
}
