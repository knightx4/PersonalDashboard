import type { CaptureContext } from '@/lib/goals/capture';

/**
 * What the capture box predicts a sentence will do, while it is being typed
 * (plan #1177).
 *
 * The capture box files a sentence as one or more of five moves
 * (lib/goals/capture.ts). Before the person presses enter, Jev picks which
 * move the sentence mainly is, and the box shows that guess under the field.
 * At 0.8 or more the guess is shown as what will happen; below it the box
 * offers the five as chips and the person picks one, or files without
 * picking and leaves it all to Haiku.
 *
 * Either way Haiku still does the filing: it is the call that knows which
 * step "the pantry" means and what the progress should say. The move Jev
 * predicted, or the one the person picked, goes into its message as a hint
 * (`captureHintLine`), which it may still override when the sentence plainly
 * says more than one thing.
 *
 * No `server-only` guard, so the client can import the labels and scripts
 * can run the question under plain `tsx`.
 */

export type CaptureMove = 'close' | 'count' | 'progress' | 'reading' | 'add';

export const CAPTURE_MOVE_OPTIONS: Readonly<Record<CaptureMove, string>> = {
  close:
    'It says the whole of an existing one-off step or task is now finished, with nothing of it left to do.',
  count:
    'It reports one or more occurrences of something done repeatedly on a rhythm, such as attending an event, sending applications, posting, or doing a routine reset.',
  progress:
    'It reports part of the work on a step or goal without finishing it, such as some of the bags moved or one of several rooms done, or news, a lead or a result towards a goal.',
  reading:
    'It gives the current value of a number being tracked, such as a balance owed, an amount saved or a weight.',
  add: 'It names something that still has to be done: a new task, a follow-up, or something to look into later.',
};

export const CAPTURE_MOVES = Object.keys(CAPTURE_MOVE_OPTIONS) as CaptureMove[];

export function isCaptureMove(value: unknown): value is CaptureMove {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CAPTURE_MOVE_OPTIONS, value);
}

export const CAPTURE_SORT_QUESTION = {
  type: 'choice',
  question:
    'The person wrote this sentence in the capture box of their goals tracker. ' +
    'What does it mainly do to their goals and steps?',
  options: CAPTURE_MOVE_OPTIONS,
} as const;

/** How the box names each move: the guess, and the chips when it asks. */
export const CAPTURE_MOVE_LABELS: Readonly<Record<CaptureMove, string>> = {
  close: 'Close a step',
  count: 'Count towards a rhythm',
  progress: 'Log progress',
  reading: 'Record a number',
  add: 'Add a step',
};

/** How long typing has to pause before the sentence is sent to be sorted. */
export const CAPTURE_SORT_DEBOUNCE_MS = 300;
/** Shorter than this and there is nothing to sort yet. */
export const CAPTURE_SORT_MIN_CHARS = 8;
/** The box gives up on a guess past this; filing does not wait for one. */
export const CAPTURE_SORT_TIMEOUT_MS = 2_000;
/** The most step titles Jev is shown, so a large tree cannot slow the guess. */
const MAX_OUTLINE_STEPS = 120;

/**
 * What Jev reads: the sentence, and an outline of the open goals and steps
 * without refs or ids, so it can tell a step being finished from progress
 * that finishes none, and a rhythm being counted from a one-off.
 */
export function captureSortState(
  body: string,
  context: CaptureContext | null,
): Record<string, unknown> {
  const sentence = body.trim();
  if (!context) return { sentence };
  const steps = context.steps.slice(0, MAX_OUTLINE_STEPS);
  return {
    sentence,
    goals: context.goals.map((goal) => ({
      goal: goal.title,
      ...(goal.unit ? { tracked_number: goal.unit } : {}),
      steps: steps
        .filter((step) => step.goalRef === goal.ref)
        .map((step) => (step.kind === 'rhythm' ? `${step.title} (rhythm)` : step.title)),
    })),
  };
}

/**
 * The line added to Haiku's message when the move is known, from Jev's
 * confident guess or the person's pick. Haiku still decides which step or
 * goal it applies to and may add a second move the sentence also makes.
 */
export function captureHintLine(move: CaptureMove, picked: boolean): string {
  const who = picked ? 'The person says' : 'A classifier is confident';
  return (
    `${who} this sentence is mainly a "${move}" move. File it as that unless the sentence plainly says otherwise; add other moves only where the sentence also makes them. ` +
    'Part of a step\'s work is progress on that step, never a close, whatever this line says.'
  );
}

/** The guess the box shows, as the server hands it back. */
export type CaptureGuess = { move: CaptureMove; confidence: number; sure: boolean };
