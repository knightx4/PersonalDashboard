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

import type {
  FeedbackHealth,
  FindingHealth,
  IdeaHealth,
  RaisedHealth,
} from '@/lib/dev/health';
import type { PlanHealth, PlanMove } from '@/lib/plan/tree';

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
 * What the plan's Status column says -- whose move it is, not how far along.
 *
 * None of these is one of the five shared states, and that is the point: every
 * word above answers "how far through is this", and every word here answers
 * "who has to act next". A row is in exactly one of each, which is why the two
 * are now two columns.
 *
 * "Needs you" and "Yours" are both you and they are not the same thing. Needs
 * you is a stop: a question to answer, a proposal to approve, a step blocked on
 * a credential -- until you do something, nothing can. Yours is ordinary work
 * in your court that nobody has handed anywhere.
 *
 * "Held up" rather than a second "waiting": the shared vocabulary already
 * spends "Waiting on you" on the person, and this one means the opposite --
 * another step is in the way and you are not what it needs.
 *
 * A settled row says nothing at all. It has no next move, and an em dash in
 * the column would be a fact nobody needed on the rows nobody is scanning
 * (law 1).
 */
export const PLAN_MOVE_WORD: Record<PlanMove, string> = {
  resolving: 'Resolving answers',
  on_you: 'Needs you',
  with_dash: 'With Dash',
  for_dash: 'For Dash',
  waiting: 'Held up',
  yours: 'Yours',
  settled: '',
};

/**
 * What a note in the bugs queue is called.
 *
 * Five of the seven are states every dev queue has, so they take the shared
 * word. `Answered` and `Planned` are this queue's own: a note you have replied
 * to is a session's again, and a note written into the build plan is worked
 * from there.
 */
export const FEEDBACK_HEALTH_WORD: Record<FeedbackHealth, string> = {
  waiting: DEV_STATE_WORD.waiting,
  answered: 'Answered',
  ready: DEV_STATE_WORD.ready,
  planned: 'Planned',
  working: DEV_STATE_WORD.working,
  done: DEV_STATE_WORD.done,
  dropped: DEV_STATE_WORD.dropped,
};

/**
 * What a raise is called.
 *
 * `Nothing done` is its own, and it is the state this queue exists to show: a
 * raise answered with no action and no reason for none is not finished, whatever
 * its status column says.
 *
 * `Answered` is its own for the same reason: you replied and something came of
 * it, which no other queue has a word for and which is not the end of the row.
 * The end of it is, and that takes the shared word -- a raise you are finished
 * with is the same fact as a step built and a note fixed.
 */
export const RAISED_HEALTH_WORD: Record<RaisedHealth, string> = {
  waiting: DEV_STATE_WORD.waiting,
  unfinished: 'Nothing done',
  answered: 'Answered',
  closed: DEV_STATE_WORD.done,
  dropped: DEV_STATE_WORD.dropped,
};

/**
 * What a UI finding is called.
 *
 * `Confirmed` rather than the shared `Ready`: a pass proposed it and you agreed
 * it is real, which is a step between being filed and being worked that no
 * other queue has.
 */
export const FINDING_HEALTH_WORD: Record<FindingHealth, string> = {
  waiting: DEV_STATE_WORD.waiting,
  ready: 'Confirmed',
  dropped: DEV_STATE_WORD.dropped,
};

/**
 * What an idea is called.
 *
 * `Dismissed` rather than `Dropped`: putting an idea aside is "not right now"
 * and one press brings it back, which is not the same as deciding against a
 * step. The three before it say what became of it -- nothing yet, a proposal
 * waiting on your approval, a feature being built, a feature finished.
 */
export const IDEA_HEALTH_WORD: Record<IdeaHealth, string> = {
  open: 'Not shaped',
  waiting: DEV_STATE_WORD.waiting,
  shaped: 'Shaped',
  done: DEV_STATE_WORD.done,
  dropped: DISMISSED_WORD,
};

/**
 * Which shared state a plan step's health is.
 *
 * The plan reads more states off six statuses than any other queue, and most
 * of them are refinements nothing else has: a question nobody has answered, a
 * proposal nobody has approved, a step waiting on another step, a step simply
 * not reached yet, and a claim whose session stopped pushing. Those keep the
 * plan's own words. The ones mapped here are the states another queue could
 * word differently.
 */
export function planState(health: PlanHealth): DevState | null {
  switch (health) {
    case 'blocked':
      return 'waiting';
    case 'ready':
      return 'ready';
    // The three readings of a claim are all "working" to another queue. Which
    // of them it is turns on whether the session is still pushing, and no other
    // queue has a session pushing anything -- so the difference is the plan's
    // own and is said in the plan's own words.
    case 'in_progress':
    case 'working':
    case 'quiet':
      return 'working';
    case 'done':
      return 'done';
    case 'dropped':
      return 'dropped';
    // A claim whose run stopped without closing the step. Nothing else has a
    // run to stop, so this one has no shared word either.
    case 'abandoned':
    case 'unanswered':
    case 'answered':
    case 'proposed':
    case 'waiting':
    case 'not_started':
      return null;
  }
}

/**
 * Why a plan step is on your desk, on the Dash tab.
 *
 * Three of the thirteen plan healths, and the only three `needsThePerson`
 * admits.
 * They take their own words rather than the shared ones because the shared
 * `Waiting on you` is the section they sit in: repeating it on every row would
 * say the same thing four times and tell you nothing about which of the three
 * this is (law 1).
 */
export const WAITING_WORD: Record<'blocked' | 'unanswered' | 'proposed', string> = {
  blocked: 'Stopped',
  unanswered: 'Question',
  proposed: 'To approve',
};
