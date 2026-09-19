import { isClosed, type PlanAssignee, type PlanKind, type PlanStatus } from './load';

/**
 * Writing down the thing only you can supply, as a job rather than a wall.
 *
 * A session that runs into a missing key used to mark the step it was on as
 * `blocked` and write the request into that row's ask. The request then lived
 * inside work you were never going to do yourself, nothing on the plan said
 * whose move it was, and setting the key later moved nothing: somebody had to
 * find the blocked row and unblock it by hand.
 *
 * `plan.ts needs "…" --for <n>` is the move that replaces it. It writes one
 * setup step -- a job of yours, in the plan, with a title you can read in a
 * list and a detail saying what to actually do -- and one `plan_dependencies`
 * row from the stopped work to it. Closing the setup step is then the whole
 * of unblocking the work, because `isStaleBlock` and `isReady` in tree.ts
 * already free a step once everything it waits on has closed.
 *
 * This file is the part of that with no database in it: where the new step
 * goes, what is refused, what the waiting step becomes, and what is printed.
 * The CLI is the only caller, and the CLI is the one thing here that cannot
 * be run in a test.
 */

/**
 * A setup job is always yours.
 *
 * Not `null` and never `claude`: the row exists precisely because a session
 * cannot do it, and an unassigned one reads on the page as a job nobody has
 * been given. `workOrder` withholds it from `--claude` on its kind (#597), so
 * this is about who it reads as belonging to, not about who could claim it.
 */
export const SETUP_ASSIGNEE: PlanAssignee = 'me';

export const SETUP_KIND: PlanKind = 'setup';

/** The little a `needs` has to know about the step that ran into the wall. */
export type WaitingStep = {
  id: string;
  number: number;
  parentId: string | null;
  kind: PlanKind;
  status: PlanStatus;
};

/**
 * Where the new setup step goes: with the work that ran into it.
 *
 * Decision #599 settled this as A — under the feature that ran into it,
 * rather than one shared row per key at the top of the plan. So the setup
 * step is a sibling of the stopped step, under the same parent, and counts
 * toward that feature's progress like any other sub-step. A step that has no
 * parent is itself the feature, and the setup job goes underneath it.
 *
 * The immediate parent rather than the top of the tree: a sibling sits next
 * to the work it is holding up on the page, which is where somebody reading
 * that work will look for it. Two features needing the same key get two rows,
 * which #599 chose over a dependency pointing out of the workspace you are
 * reading.
 */
export function setupHome<T extends { id: string; number: number; parentId: string | null }>(
  waiting: T,
  parent: T | null,
): T {
  return waiting.parentId && parent ? parent : waiting;
}

/**
 * Why a `needs` cannot be written against this step, or null when it can.
 *
 * Both refusals are about the dependency edge being a lie rather than about
 * tidiness. Nothing waits on anything from a step that is already finished,
 * and a setup step waiting on a setup step says a job of yours is stopping
 * another job of yours, which is not what happened: whoever meant that wants
 * one row with both things in its detail.
 */
export function needsRefusal(waiting: WaitingStep): string | null {
  if (isClosed(waiting.status)) {
    return `#${waiting.number} is already closed, so nothing is waiting on this. Name the step that is stopped.`;
  }
  if (waiting.kind === SETUP_KIND) {
    return `#${waiting.number} is itself a setup job. Say both things in its detail rather than pointing one at the other.`;
  }
  return null;
}

/**
 * Whether writing the setup step also takes the waiting step off `blocked`.
 *
 * The whole point of the move: the work stops reading as "Claude got stuck"
 * and starts reading as "waiting on a job of yours", which is the dependency
 * row, not the status. A step left `blocked` as well would keep its ask --
 * the sentence asking you for the key -- in a second place, and clearing the
 * dependency later would not clear that. So a blocked step goes back to not
 * started and its ask goes with it.
 *
 * Anything else is left exactly as it is. A step still `in_progress` belongs
 * to the session running this, and whether that session carries on or hands
 * over is its business, not this command's.
 */
export function releasesBlock(status: PlanStatus): boolean {
  return status === 'blocked';
}

/** What `needs` prints: the two numbers it wrote, and what it did to them. */
export function needsLines(outcome: {
  setupNumber: number;
  title: string;
  parentNumber: number;
  waitingNumber: number;
  released: boolean;
  hasDetail: boolean;
}): string[] {
  const lines = [
    `#${outcome.setupNumber} for you to set up, under #${outcome.parentNumber}: ${outcome.title}`,
    `#${outcome.waitingNumber} waits on #${outcome.setupNumber}.`,
  ];
  if (outcome.released) {
    lines.push(
      `#${outcome.waitingNumber} was blocked; it is back to not started and waits on ` +
        `#${outcome.setupNumber} instead.`,
    );
  }
  if (!outcome.hasDetail) {
    // The title is the one-line summary and the detail is what to actually
    // go and do -- #599 asked for both, and the plan page and the Dash tab
    // draw them in exactly those roles. Without one the page shows the
    // summary twice, which is not wrong, only thin.
    lines.push(
      `Written with no --detail, so the summary is all you will have to go on when you come ` +
        `to do it.`,
    );
  }
  return lines;
}

/**
 * Why `start` will not take a setup step, and where it is closed instead.
 *
 * The same refusal `start` makes on a decision, for the same reason: the row
 * is the person's move, and a session that claimed one would sit in front of
 * the wall the row was written to describe. It says where the job is closed,
 * because "you cannot have this" with no next move is how a session ends up
 * inventing one.
 */
export function setupStartRefusal(number: number): string {
  return (
    `#${number} is something for you to set up, not work to build. It is closed where it is ` +
    `read: on /dev/plan or the Dash tab's "Waiting on you", with "I have set this up".`
  );
}
