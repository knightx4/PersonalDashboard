import type { Move } from '@/lib/core/move';
import { isTerminal, type ApplicationEventKind, type ApplicationStatus } from './pipeline';

/**
 * Whose move an application is (plan #1454; docs/CORE-AND-DASH-SPEC.md,
 * Part 3), worked out from its stage and the last thing that happened.
 *
 * The words come from lib/core/move.ts. This says which state, and a tooltip
 * that says why in the pipeline's own terms.
 */

/**
 * Events that say nothing about whose turn it is: a note you wrote and a
 * card you dragged. The last event that counts is the one before them.
 */
const NOT_A_TURN: ReadonlySet<ApplicationEventKind> = new Set(['note', 'status_override']);

/** The newest event that says whose turn it is, from kinds newest first. */
export function lastTurnEvent(kindsNewestFirst: readonly string[]): ApplicationEventKind | null {
  for (const kind of kindsNewestFirst) {
    if (!NOT_A_TURN.has(kind as ApplicationEventKind)) return kind as ApplicationEventKind;
  }
  return null;
}

const OFFER = 'There is an offer to answer.';

/** After these, the next thing has to come from you. */
const YOURS_AFTER: Partial<Record<ApplicationEventKind, string>> = {
  recruiter_reply: 'They wrote back, and the reply is yours.',
  assessment_sent: 'They sent an assessment for you to do.',
  screen_scheduled: 'A screen is booked; preparing for it is yours.',
  interview_scheduled: 'An interview is booked; preparing for it is yours.',
  offer: OFFER,
};

export type ApplicationMoveInput = {
  status: ApplicationStatus;
  /** The newest event that counts (`lastTurnEvent`), or null when there is none. */
  lastEvent: ApplicationEventKind | null;
  companyName: string;
};

/**
 * The move, and the tooltip it is shown with. Null on a closed application:
 * rejected, withdrawn, ghosted or closed has nothing left to do.
 */
export function applicationMove({
  status,
  lastEvent,
  companyName,
}: ApplicationMoveInput): { move: Move; title: string } | null {
  if (isTerminal(status)) return null;

  if (status === 'lead' || status === 'drafting') {
    return { move: { state: 'on_you' }, title: 'Not sent yet; applying is yours.' };
  }
  if (status === 'offer') {
    return { move: { state: 'on_you' }, title: OFFER };
  }

  const yours = lastEvent ? YOURS_AFTER[lastEvent] : undefined;
  if (yours) return { move: { state: 'on_you' }, title: yours };

  const company = companyName.trim();
  return {
    move: { state: 'waiting', waitingOn: company || undefined },
    title:
      status === 'submitted' || status === 'acknowledged'
        ? 'Sent; the next move is theirs.'
        : 'The last move was yours; the next one is theirs.',
  };
}
