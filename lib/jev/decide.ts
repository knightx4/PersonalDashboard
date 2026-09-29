import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import {
  askJev,
  type JevAnswerFor,
  type JevFailure,
  type JevQuestion,
  type JevState,
} from '@/lib/jev/client';

/**
 * Jev first, the existing Haiku call when Jev cannot be trusted with it.
 *
 * The one rule every step of feature #1161 uses: Jev's answer stands when its
 * confidence is 0.8 or more. Below that, or when the call fails for any
 * reason (no key, TypeSafe down, a malformed answer), the caller's own
 * fallback runs and its answer is the one used. A caller moving from Haiku
 * passes the Haiku call it already has as `fallback`, and `read` to turn
 * Jev's answer into the same value that call returns.
 *
 * Two more ways to reach the fallback. `enabled: false` skips Jev entirely,
 * for an account that has not agreed to send its text to TypeSafe
 * (lib/jev/enabled.ts): no call is made and nothing is sent. `trust` names
 * answers Jev is not good at, such as a label the trial found it unreliable
 * on, and sends them to the fallback whatever their confidence.
 *
 * Jev's spend goes to `onSpend`; the fallback reports its own as it does now,
 * so a low-confidence decision records two rows, one per model.
 */

/** At or above this, Jev's answer is used without a second opinion. */
export const JEV_CONFIDENCE_FLOOR = 0.8;

/** Why the fallback ran, handed to it in case it wants Jev's answer as a hint. */
export type FallbackReason<A> =
  | { why: 'low-confidence'; jev: A; confidence: number }
  | { why: 'not-trusted'; jev: A; confidence: number }
  | { why: 'jev-failed'; failure: JevFailure }
  | { why: 'not-enabled' };

export type Decided<T, A> =
  | { value: T; by: 'jev'; jev: A; confidence: number }
  | ({ value: T; by: 'fallback' } & FallbackReason<A>);

export type DecideInput<Q extends JevQuestion, T> = {
  state: JevState;
  question: Q;
  /** Turns Jev's answer into the value the caller works with. */
  read: (answer: JevAnswerFor<Q>) => T;
  /** The call used before Jev, usually Haiku. Its errors are the caller's, as before. */
  fallback: (reason: FallbackReason<JevAnswerFor<Q>>) => Promise<T>;
  /** Where Jev's cost goes. */
  onSpend?: SpendSink;
  /** Defaults to JEV_CONFIDENCE_FLOOR. */
  floor?: number;
  /**
   * False when the account has not agreed to send text to TypeSafe
   * (jevEnabledFor). Jev is not asked and the fallback runs. Defaults to true.
   */
  enabled?: boolean;
  /** An answer this returns false for goes to the fallback whatever its confidence. */
  trust?: (answer: JevAnswerFor<Q>) => boolean;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export async function decideWithJev<Q extends JevQuestion, T>(
  input: DecideInput<Q, T>,
): Promise<Decided<T, JevAnswerFor<Q>>> {
  if (input.enabled === false) {
    const reason: FallbackReason<JevAnswerFor<Q>> = { why: 'not-enabled' };
    return { value: await input.fallback(reason), by: 'fallback', ...reason };
  }

  const result = await askJev({
    state: input.state,
    question: input.question,
    onSpend: input.onSpend,
    apiKey: input.apiKey,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });

  if (!result.ok) {
    // The detail is a status and TypeSafe's error text, never the state. A
    // missing key is not logged: it is the normal case on a local checkout.
    if (result.reason !== 'no-key') console.warn(`[jev] ${result.reason}: ${result.detail}`);
    const reason: FallbackReason<JevAnswerFor<Q>> = { why: 'jev-failed', failure: result };
    return { value: await input.fallback(reason), by: 'fallback', ...reason };
  }

  const { answer } = result;
  if (input.trust && !input.trust(answer)) {
    const reason: FallbackReason<JevAnswerFor<Q>> = {
      why: 'not-trusted',
      jev: answer,
      confidence: answer.confidence,
    };
    return { value: await input.fallback(reason), by: 'fallback', ...reason };
  }
  if (answer.confidence >= (input.floor ?? JEV_CONFIDENCE_FLOOR)) {
    return { value: input.read(answer), by: 'jev', jev: answer, confidence: answer.confidence };
  }

  const reason: FallbackReason<JevAnswerFor<Q>> = {
    why: 'low-confidence',
    jev: answer,
    confidence: answer.confidence,
  };
  return { value: await input.fallback(reason), by: 'fallback', ...reason };
}
