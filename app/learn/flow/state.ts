import type { NextQuestion } from '@/lib/learn/flow/ahead';
import type { NothingToAsk } from '@/lib/learn/graph/pick';
import type { SettledConcept } from '@/lib/learn/graph/recheck';
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
};

/** What the screen shows for the next question, or why there is none. */
export function toFlowState(next: NextQuestion): FlowState {
  if (next.kind === 'nothing') return { nothing: next.because };
  if (next.kind === 'error') return { error: next.detail };
  return { ...next.question };
}
