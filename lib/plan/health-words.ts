/**
 * The words, tones and tooltips for a step's state (plan #994).
 *
 * Which state a step is in is decided in lib/plan/tree.ts; this is how each
 * state is said. Pure and free of `PlanNode`, so the dev plan and a goal's
 * page draw the same state in the same words: each page works out the state
 * its own way and hands over the few facts a tooltip needs.
 */
import type { DevTone } from '@/components/dev/state-label';
import { DEV_STATE_WORD, PLAN_MOVE_WORD } from '@/lib/dev/words';
import { PLAN_HEALTH_GLYPHS, type StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import type { PlanHealth, PlanMove } from '@/lib/plan/tree';

/**
 * What the health column says about a step.
 *
 * The stored status is what you set; health is what it means right now. A
 * step not yet started is either ready, waiting on something, or simply not
 * reached -- three different answers the one word "not started" was hiding.
 * The other statuses say what they are. Done and dropped are the quiet ones:
 * finished work is consulted, not read.
 */
export type HealthWord = {
  word: string;
  /**
   * The six the dev pages share. `info` is the app's blue and deliberately not
   * `accent`: the accent is whichever hue the workspace you are standing in
   * owns, so an accent-toned state is a different colour on every page and
   * slate on this one.
   */
  tone: DevTone;
  title?: string;
};

/**
 * How each state is worded.
 *
 * Which state a step is in is decided in lib/plan/tree.ts, so the counts
 * beside a module heading and the health column under it cannot disagree.
 * Which shape it draws is in lib/status-glyphs.ts, beside the pipeline's and
 * the todo list's, so a state here looks like the same state there. What is
 * left is the word, the tone and the fixed part of the tooltip.
 *
 * Seven of the fourteen are states the other dev queues have too, and those
 * words come from lib/dev/words.ts so a dropped step and a declined note read
 * alike. The other seven are the plan's own refinements -- a question, a
 * question answered, a proposal, a step waiting on another step, a step nobody
 * has reached, a claim whose run stopped, and a setup job that is yours to do
 * -- and no other queue has anything for them to disagree with. Why there are
 * fourteen rather than fewer is written where the set is, in
 * lib/plan/tree.ts.
 *
 * Fourteen words, three colours (note 42aa1fa4): anything that cannot be
 * taken yet, for whatever reason, is amber; ready or underway is blue; done is
 * green. Dropped is the one outside the three, because it is none of them.
 */
export const HEALTH: Record<PlanHealth, HealthWord> = {
  unanswered: {
    word: 'Unanswered',
    tone: 'caution',
    title: 'A question waiting on you. It closes on an answer, not a commit.',
  },
  answered: { word: 'Answered', tone: 'positive' },
  proposed: {
    word: 'Proposed',
    tone: 'caution',
    title: 'Written by a session. Approve it, edit it, or drop it -- nothing happens until you do.',
  },
  in_progress: { word: DEV_STATE_WORD.working, tone: 'info' },
  // The three readings of a claim. `in_progress` above is the fourth and says
  // the least: the row is claimed and nothing has looked into what the session
  // is doing.
  working: {
    word: DEV_STATE_WORD.working,
    tone: 'info',
    title: 'A session has this and has pushed something recently.',
  },
  quiet: {
    word: 'Quiet',
    tone: 'info',
    title:
      'A session has this and has pushed nothing for a while. It may still be reading or waiting on a build.',
  },
  abandoned: {
    word: 'Stopped',
    tone: 'caution',
    title:
      'A session claimed this and stopped without closing it. Put it back or send it again -- nothing is working it.',
  },
  // "Waiting on you" rather than "Blocked", which said a step was stuck and not
  // who could unstick it. The notes queue says the same thing about a note
  // blocked on an answer, and now says it in the same words.
  blocked: {
    word: DEV_STATE_WORD.waiting,
    tone: 'caution',
    title: 'Stopped on something only you can settle. The note says what.',
  },
  // A job that was yours from the day it was written -- an account, a key, a
  // switch. "Waiting on you" is what a blocked step says, and it says it about
  // a build that ran into a wall; this one never was a build.
  setup: {
    word: 'Setup',
    tone: 'caution',
    title: 'Something only you can set up. Open it for what to do, and say so when you have.',
  },
  // A step waiting on another step, which clears itself. Nothing else to say
  // "on you" about, and the plan is the only queue that has it.
  waiting: { word: 'Waiting', tone: 'caution' },
  // Blue, not green. Ready and done were both `positive`, so the one state
  // that is an invitation to start read at a glance as the state that needs
  // nothing.
  //
  // `info` and not `accent`, which is what it used to be and which was not
  // blue anywhere it was read: the accent is the workspace's hue, and this
  // page lives in the dev workspace, whose hue is slate. "Blue" was written
  // in this comment and rendered as grey on the only page that shows it.
  // `info` is the app's own blue, themed in all five palettes, and it does
  // not move when the workspace does.
  ready: { word: DEV_STATE_WORD.ready, tone: 'info' },
  not_started: { word: 'Not started', tone: 'caution' },
  done: { word: DEV_STATE_WORD.done, tone: 'positive' },
  dropped: { word: DEV_STATE_WORD.dropped, tone: 'ghost' },
};

/** A step as a tooltip names it: "#12 The title". */
export type StepRef = { number: number; title: string };

/**
 * What the tooltip on a health word needs to know about the step, beyond its
 * state. Plain values rather than a `PlanNode`, so a page whose rows are not
 * plan rows can say the same thing in the same words.
 */
export type HealthFacts = {
  /** Whether the step itself is done or dropped. */
  closed: boolean;
  /** The open steps anywhere beneath it, for a closed row over open work. */
  openBeneath: readonly StepRef[];
  resolution: string | null;
  blockAsk: string | null;
  comment: string | null;
  /** What holds it up, for the Waiting tooltip. */
  waitingOn: readonly StepRef[];
};

const named = (ref: StepRef) => `#${ref.number} ${ref.title}`;

export function healthOf(
  health: PlanHealth,
  facts: HealthFacts,
): HealthWord & { glyph: GlyphName; name: PlanHealth } {
  const base = { ...HEALTH[health], glyph: PLAN_HEALTH_GLYPHS[health], name: health };

  // A row closed over open work reports what is open beneath it, so the word
  // is about a step further down and the fixed tooltip would be describing the
  // wrong row. Naming the rows is the whole answer to "why does this say that".
  if (facts.closed && health !== 'done' && health !== 'dropped' && health !== 'answered') {
    const open = facts.openBeneath;
    return {
      ...base,
      title: `Closed, but still open beneath it: ${open
        .slice(0, 3)
        .map(named)
        .join(', ')}${open.length > 3 ? `, and ${open.length - 3} more` : ''}`,
    };
  }

  // The three tooltips that can only be written with the step in hand.
  if (health === 'answered') return { ...base, title: facts.resolution ?? undefined };
  if (health === 'blocked') return { ...base, title: facts.blockAsk ?? facts.comment ?? undefined };
  if (health === 'waiting') {
    return { ...base, title: `Waits on ${facts.waitingOn.map(named).join(', ')}` };
  }
  return base;
}

/**
 * The Status column, worded and toned.
 *
 * The same three colours as the health column (note 42aa1fa4). What is being
 * worked right now -- "With Dash", or a re-shape resolving answers -- is blue.
 * Everything still to do that nobody is working is amber: a step on you, one
 * you kept, one another step is holding up. A step waiting its turn has no
 * word to tone, and nor does one that is settled.
 *
 * The tooltip is where the rollup is explained. A feature reporting "With Dash"
 * because its third step is with a session would otherwise be a word with no
 * visible cause, which is the complaint the whole column exists to answer.
 */
export const MOVE_TONE: Record<PlanMove, DevTone> = {
  resolving: 'info',
  on_you: 'caution',
  with_dash: 'info',
  waiting: 'caution',
  yours: 'caution',
  none: 'ghost',
  settled: 'ghost',
};

export const MOVE_TITLE: Record<PlanMove, string> = {
  resolving:
    'Re-reading this feature against the answers you just gave. What it proposes will be here when it is done; sending it anywhere until then would send a plan that is mid-edit.',
  on_you:
    'Stopped on you: a question to answer, a proposal to approve, or something only you can supply.',
  with_dash: 'A session is working on this now.',
  waiting: 'Held up by another step that has not closed.',
  yours: 'You kept this one, so the runner will not take it.',
  none: 'Approved and waiting its turn. Nothing is on it and nothing is needed from you.',
  settled: 'Nothing left to do on this one.',
};

/**
 * The Status word for a step's move.
 *
 * `own` is what the row alone would say, with nothing beneath it counted. When
 * it differs from `move`, the word came up from a step further down and the
 * tooltip says so.
 */
export function moveFor(
  move: PlanMove,
  own: PlanMove,
): { word: string; tone: DevTone; title?: string } {
  return {
    word: PLAN_MOVE_WORD[move],
    tone: MOVE_TONE[move],
    // Said only where it is not obvious from the row itself: a leaf reporting
    // its own move needs no explanation of where the word came from.
    title: own === move ? MOVE_TITLE[move] : `${MOVE_TITLE[move]} (from a step beneath this one.)`,
  };
}

/** The fill for a tone, where a state is a dot or a band rather than a word. */
export const TONE_DOT: Record<DevTone, string> = {
  quiet: 'bg-ink-ghost',
  ghost: 'bg-ink-ghost',
  accent: 'bg-accent',
  info: 'bg-status-submitted',
  positive: 'bg-positive',
  caution: 'bg-caution',
};
