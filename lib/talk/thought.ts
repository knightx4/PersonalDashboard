import { OPUS } from '@/lib/core/models';
import type { TalkToolCall } from './talk';

/**
 * The mark a thought-through answer keeps (plan #2789.10; lib/dash/think.ts):
 * one more tool call on the turn, `think_it_through`, holding the model, the
 * effort and what the answer cost, which the line under the answer reads.
 * Nothing here reads a database or the network, so the thread imports it.
 */

/** The call the answer keeps to say it was thought through, and what it cost. */
export const THOUGHT_CALL = 'think_it_through';

export type DashThought = { model: string; effort: string; costMicros: number | null };

/** The marker kept with the answer's tool calls. */
export function thoughtCall(thought: DashThought): TalkToolCall {
  return { name: THOUGHT_CALL, input: { model: thought.model, effort: thought.effort }, result: { ok: true, costMicros: thought.costMicros } };
}

/** Whether an answer was thought through, and what it cost; null for an ordinary answer. */
export function turnThought(calls: readonly TalkToolCall[] | undefined): DashThought | null {
  const call = calls?.find((c) => c.name === THOUGHT_CALL);
  if (!call) return null;
  const input = call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};
  const result = call.result && typeof call.result === 'object' ? (call.result as Record<string, unknown>) : {};
  const cost = result.costMicros;
  return {
    model: typeof input.model === 'string' ? input.model : OPUS,
    effort: typeof input.effort === 'string' ? input.effort : 'high',
    costMicros: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

