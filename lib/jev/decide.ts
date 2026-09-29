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
 * Jev's spend goes to `onSpend`; the fallback reports its own as it does now,
 * so a low-confidence decision records two rows, one per model.
 */

/** At or above this, Jev's answer is used without a second opinion. */
export const JEV_CONFIDENCE_FLOOR = 0.8;

/** Why the fallback ran, handed to it in case it wants Jev's answer as a hint. */
export type FallbackReason<A> =
  | { why: 'low-confidence'; jev: A; confidence: number }
  | { why: 'jev-failed'; failure: JevFailure };

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
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export async function decideWithJev<Q extends JevQuestion, T>(
  input: DecideInput<Q, T>,
): Promise<Decided<T, JevAnswerFor<Q>>> {
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
