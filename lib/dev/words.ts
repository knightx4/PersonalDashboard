/**
 * The words the dev queues share, so one idea reads as one idea.
 *
 * Five queues -- the plan, bugs and requests, raises, UI findings and ideas --
 * grew their own vocabularies, and the same fact ended up with four names: a
 * step decided against is "dropped", a note decided against is "declined", and
 * a raise and a finding decided against are both "dismissed". Nothing joins the
 * columns, so nothing forced them to agree, and reading two tabs in a row meant
 * translating.
 *
 * #496 settled that the columns keep their own values and the display converges:
 * renaming five sets of enum values buys nothing anybody can see, and the page
 * is where the confusion happens. So this is a display vocabulary. Each queue
 * says which of these states its stored status is, and the page draws the
 * shared word.
 *
 * A state a queue genuinely owns keeps its own word. A plan decision nobody has
 * answered, a note already written into the plan, a finding you confirmed: no
 * other queue has those, so there is nothing for them to disagree with. What
 * this covers is the five every queue has.
 *
 * Words only. The shape each state draws is lib/status-glyphs.ts and the rule
 * that works out which state a row is in belongs to each queue.
 */

import type { FeedbackStatus } from '@/lib/feedback/load';
import type { PlanHealth } from '@/lib/plan/tree';
import type { RaisedStatus } from '@/lib/raised/load';
import type { UiFindingStatus } from '@/lib/ui-review/load';

/** The five states every dev queue has, whatever it calls them in its column. */
export const DEV_STATES = ['waiting', 'ready', 'working', 'done', 'dropped'] as const;

export type DevState = (typeof DEV_STATES)[number];

/**
 * One word per state, and the only place any of them is written.
 *
 * "Waiting on you" rather than "blocked", because blocked says a thing is stuck
 * and not who can unstick it, and on every one of these queues the answer is
 * the person reading the page.
 *
 * "In progress" rather than the notes queue's "Dash is on this". Who holds a
 * row is a separate fact with its own mark beside the word -- the bot the notes
 * queue draws and the one the plan marks a handed-over step with -- and a row a
 * person is working reads the same as a row a session is.
 *
 * "Dropped" for the one this exists for. It was the plan's word already, it is
 * the shortest of the four, and it says a decision was made rather than that
 * something was swept away.
 */
export const DEV_STATE_WORD: Record<DevState, string> = {
  waiting: 'Waiting on you',
  ready: 'Ready',
  working: 'In progress',
  done: 'Done',
  dropped: 'Dropped',
};

/**
 * Putting a row aside is not deciding against it.
 *
 * `dropped` is a decision with a reason; a dismissal is "not right now", it
 * hides the row rather than closing it, and it is taken back by hand. The plan
 * and the ideas page both have one and both already call it this. It is here so
 * that a queue reaching for a word for it finds the one in use rather than
 * inventing a fifth.
 */
export const DISMISSED_WORD = 'Dismissed';

/**
 * Which shared state a note in the bugs queue is in.
 *
 * `planned` is the queue's own: it means the note has been written into the
 * build plan and is worked from there, which no other queue can say.
 */
export function feedbackState(status: FeedbackStatus): DevState | null {
  switch (status) {
    case 'open':
      return 'ready';
    case 'in_progress':
      return 'working';
    case 'blocked':
      return 'waiting';
    case 'done':
      return 'done';
    case 'declined':
      return 'dropped';
    case 'planned':
      return null;
  }
}

/**
 * Which shared state a raise is in.
 *
 * `answered` is its own: the person wrote a reply, which is what closes a raise
 * and is not the same as the work being finished.
 */
export function raisedState(status: RaisedStatus): DevState | null {
  switch (status) {
    case 'open':
      return 'waiting';
    case 'dismissed':
      return 'dropped';
    case 'answered':
      return null;
  }
}

/**
 * Which shared state a UI finding is in.
 *
 * `confirmed` is its own: a pass proposed it and you agreed it is real, which
 * is a step no other queue has between being filed and being worked.
 */
export function findingState(status: UiFindingStatus): DevState | null {
  switch (status) {
    case 'open':
      return 'waiting';
    case 'dismissed':
      return 'dropped';
    case 'confirmed':
      return null;
  }
}

/**
 * Which shared state a plan step's health is.
 *
 * The plan reads ten states off six statuses, and half of them are refinements
 * nothing else has: a question nobody has answered, a proposal nobody has
 * approved, a step waiting on another step, a step simply not reached yet. Those
 * keep the plan's own words. The five here are the ones another queue can
 * disagree with.
 */
export function planState(health: PlanHealth): DevState | null {
  switch (health) {
    case 'blocked':
      return 'waiting';
    case 'ready':
      return 'ready';
    case 'in_progress':
      return 'working';
    case 'done':
      return 'done';
    case 'dropped':
      return 'dropped';
    case 'unanswered':
    case 'answered':
    case 'proposed':
    case 'waiting':
    case 'not_started':
      return null;
  }
}
