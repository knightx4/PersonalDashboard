import type { NextQuestion } from '@/lib/learn/flow/ahead';
import type { NothingToAsk } from '@/lib/learn/graph/pick';
import type { SettledConcept } from '@/lib/learn/graph/recheck';
import type { TrackMove } from '@/lib/learn/flow/track';
import type { AskState } from '../s/[id]/probe/actions';

/**
 * What Practice Flow's screen holds between presses. Apart from the actions
 * because a `'use server'` file may export only actions, and the page needs
 * `toFlowState` for the question it opens on.
 */

export type FlowState = AskState & {
  /** The subject the picked claim belongs to. What the link onwards points at. */
  subjectId?: string;
  subjectName?: string;
  /** Set instead of a question when there is nothing to ask about. */
  nothing?: NothingToAsk;
  /**
   * How the claim was settled, when this question is a re-check: by a question
   * you answered, or by your saying you already knew it. Unset for an ordinary
   * question, so it reads as a flag as well as naming which of the two.
   */
  recheck?: SettledConcept['established'];
  /**
   * The track's settled count before and after the answer. Set by the answer
   * and nowhere else, so a question on screen never carries the last one's.
   */
  track?: TrackMove;
  /**
   * A reading you queued and never opened, offered under the answer. Set by
   * the answer and nowhere else, like the track: it is what Learn next used
   * to list as its third kind of row, before the flow took that page over.
   */
  reading?: FlowReading;
};

/** A queued reading as the answer panel offers it. */
export type FlowReading = {
  id: string;
  title: string;
  /** Why it is offered, in one line: which claim it was queued about. */
  reason: string;
};

/** What the screen shows for the next question, or why there is none. */
export function toFlowState(next: NextQuestion): FlowState {
  if (next.kind === 'nothing') return { nothing: next.because };
  if (next.kind === 'error') return { error: next.detail };
  // Built fresh rather than spread over the answered state, so nothing of the
  // last answer (its panel, its track line) survives onto the next question.
  return { ...next.question };
}
