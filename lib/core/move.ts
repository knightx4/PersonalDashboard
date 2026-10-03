import type { DevTone } from '@/components/dev/state-label';

/**
 * Whose move it is, said one way everywhere (docs/CORE-AND-DASH-SPEC.md,
 * Part 3; plan #1453).
 *
 * Five states, and the only place their words are written. Each workspace
 * works out which state its own rows are in and maps onto these: the plan in
 * lib/plan/health-words.ts, goals in lib/goals/status.ts. A workspace with
 * finer states of its own (the plan's re-shape in progress, a step you kept)
 * keeps the finer state for its own rules and says it with one of these
 * words.
 *
 * Moves are worked out when read and never stored. The one exception is
 * `dash_working`, which comes from the runs in progress rather than from the
 * row itself.
 */
export const MOVE_STATES = ['on_you', 'with_dash', 'dash_working', 'waiting', 'settled'] as const;
export type MoveState = (typeof MOVE_STATES)[number];

/**
 * Who a waiting row is waiting on: a ref to their row (lib/core/refs.ts) with
 * the title it is named by, or a short text such as "recruiter at EliseAI".
 */
export type WaitingOn = string | { ref: string; title: string };

/** A row's move. Only `waiting` carries anything beyond its state. */
export type Move =
  | { state: Exclude<MoveState, 'waiting'> }
  | { state: 'waiting'; waitingOn?: WaitingOn };

/**
 * The five words. `waiting` is the bare word; `moveWord` adds who, which is
 * how it is shown wherever the row knows.
 */
export const MOVE_WORD: Record<MoveState, string> = {
  on_you: 'On you',
  with_dash: 'With Dash',
  dash_working: 'Dash is on it',
  waiting: 'Waiting',
  settled: 'Done',
};

/**
 * The plan's three colours (note 42aa1fa4): anything that cannot move until
 * somebody else does is amber, what Dash has is blue, and what is finished is
 * green.
 */
export const MOVE_TONE: Record<MoveState, DevTone> = {
  on_you: 'caution',
  with_dash: 'info',
  dash_working: 'info',
  waiting: 'caution',
  settled: 'positive',
};

/** What each state means, for a tooltip where the workspace has nothing more particular. */
export const MOVE_TITLE: Record<MoveState, string> = {
  on_you: 'Nothing happens until you act.',
  with_dash: 'Dash has this and will act on its next run.',
  dash_working: 'Dash is working on this now.',
  waiting: 'Someone else has to act first.',
  settled: 'Nothing left to do.',
};

/** How the one waited on is named. */
export function waitingOnName(waitingOn: WaitingOn): string {
  return typeof waitingOn === 'string' ? waitingOn : waitingOn.title;
}

/** The word for a move: "Waiting on the recruiter at EliseAI" where it knows who. */
export function moveWord(move: Move): string {
  if (move.state === 'waiting' && move.waitingOn) {
    const name = waitingOnName(move.waitingOn).trim();
    if (name) return `${MOVE_WORD.waiting} on ${name}`;
  }
  return MOVE_WORD[move.state];
}

/**
 * The word as it reads inside a sentence or a count: "2 on you, 1 with Dash".
 * Dash keeps its capital.
 */
export function moveInline(state: MoveState): string {
  const word = MOVE_WORD[state];
  return word.startsWith('Dash') ? word : word.charAt(0).toLowerCase() + word.slice(1);
}

/** Word, tone and tooltip together, for the label that draws a move. */
export function moveLabel(move: Move): { state: MoveState; word: string; tone: DevTone; title: string } {
  return {
    state: move.state,
    word: moveWord(move),
    tone: MOVE_TONE[move.state],
    title: MOVE_TITLE[move.state],
  };
}

/**
 * The view chips over a tree of steps, for the dev plan and a goal's steps
 * alike (plan #1433). One list, so a view both pages have is called the same
 * on both, and the two that are moves use the move words. Each page offers
 * the views it has; a view only one page has is still named here.
 */
export const VIEW_LABEL = {
  all: 'Everything',
  open: 'Open',
  you: MOVE_WORD.on_you,
  ready: 'Ready',
  proposed: 'Proposed',
  claude: "Dash's",
  blocked: MOVE_WORD.waiting,
  fog: 'Not specified',
  dismissed: 'Dismissed',
  read: 'To read',
} as const satisfies Record<string, string>;
