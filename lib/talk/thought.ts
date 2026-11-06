import { OPUS } from '@/lib/core/models';
import type { TalkToolCall } from './talk';
import type { SessionMessage } from '@/lib/core/session-threads-model';

/**
 * The mark a thought-through answer keeps (plan #2789.10; lib/dash/think.ts):
 * one more tool call on the turn, `think_it_through`, holding the model, the
 * effort and what the answer cost, which the line under the answer reads.
 * Nothing here reads a database or the network, so the thread imports it.
 */

/** The call the answer keeps to say it was thought through, and what it cost. */
export const THOUGHT_CALL = 'think_it_through';

/**
 * `fallback`, when set, is why the question was answered here rather than in
 * a session thread (plan #2789.11), as the line under the answer says it.
 */
export type DashThought = { model: string; effort: string; costMicros: number | null; fallback?: string | null };

/** The marker kept with the answer's tool calls. */
export function thoughtCall(thought: DashThought): TalkToolCall {
  return {
    name: THOUGHT_CALL,
    input: { model: thought.model, effort: thought.effort, ...(thought.fallback ? { fallback: thought.fallback } : {}) },
    result: { ok: true, costMicros: thought.costMicros },
  };
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
    fallback: typeof input.fallback === 'string' && input.fallback.trim() ? input.fallback.trim() : null,
  };
}

/**
 * The mark a question sent to a session thread keeps (plan #2789.11): the
 * answer Ask Dash wrote at once carries this call with the thread's id, and
 * the line under it follows the thread live until the session answers.
 */
export const SESSION_SENT_CALL = 'think_in_session';

export type DashSessionSent = { threadId: string };

/**
 * What Ask Dash says at once when a question has gone to a session thread
 * (plan #2789.11). The line under it links the thread and follows it live.
 */
export const SESSION_SENT_BODY =
  'I have passed this to a session to think through, with the whole repository, the web and no time limit. It reads and weighs, and changes nothing. Its answer will be in the session thread, and a notification opens it when it lands.';

/** The marker kept with the reply that says the question went to a session. */
export function sessionSentCall(sent: DashSessionSent): TalkToolCall {
  return { name: SESSION_SENT_CALL, input: { thread_id: sent.threadId }, result: { ok: true } };
}

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The thread a reply sent its question to; null for any other reply. */
export function turnSessionSent(calls: readonly TalkToolCall[] | undefined): DashSessionSent | null {
  const call = calls?.find((c) => c.name === SESSION_SENT_CALL);
  if (!call) return null;
  const input = call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};
  const id = input.thread_id;
  return typeof id === 'string' && THREAD_ID.test(id) ? { threadId: id } : null;
}

/**
 * Why a thought-through question was answered here and not in a session
 * thread, as the line under the answer finishes "Answered here: …".
 */
export const THINK_FALLBACK = {
  noBroker: 'no session runner is set up on this deployment',
  notStarted: 'the session thread could not be started',
} as const;


/**
 * Where a question sent to a session stands, for the line under Ask Dash's
 * reply (plan #2789.11), from the thread as heard live: the session's answer
 * once it has written one, its question back while one waits, otherwise the
 * newest line on what it is doing, or that it has not started.
 */
export type SessionSentState =
  | { state: 'answered' }
  | { state: 'asked' }
  | { state: 'working'; line: string }
  | { state: 'waiting' };

export function sessionSentState(
  messages: readonly Pick<SessionMessage, 'author' | 'kind' | 'answer'>[],
  latest: string | null,
): SessionSentState {
  const said = messages.filter((m) => m.author === 'session' && m.kind !== 'status');
  if (said.some((m) => m.kind === 'question' && m.answer === null)) return { state: 'asked' };
  if (said.some((m) => m.kind === 'text')) return { state: 'answered' };
  return latest?.trim() ? { state: 'working', line: latest.trim() } : { state: 'waiting' };
}
