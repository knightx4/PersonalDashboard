import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { brokerWakeText } from './broker-model';

/**
 * Wake the session broker for a thread (plan #2789.6): fire its wake-up task
 * with a text naming the thread. The broker then passes every waiting
 * message, in this thread and any other, to its session.
 *
 * Called after the person's row is saved, so a failure never loses what they
 * wrote. When the broker cannot be woken, a status line in the thread says
 * so, since otherwise nothing on the screen would show that the message is
 * stuck. Never fires without the broker's own id: fireFeatureRoutine would
 * fall back to the default routine, which builds plan steps.
 */
export async function wakeBroker(deps: {
  core: CoreSupabaseClient;
  userId: string;
  threadId: string;
  routine: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { routine } = deps;
  const fired =
    routine.id && routine.token
      ? await fireFeatureRoutine({
          apiKey: routine.token,
          routineId: routine.id,
          text: brokerWakeText(deps.threadId),
          fetch: deps.fetch,
        })
      : {
          ok: false as const,
          error: `${routine.id ? 'CLAUDE_BROKER_ROUTINE_TOKEN' : 'CLAUDE_BROKER_ROUTINE_ID'} is not set on the deployment.`,
        };
  if (fired.ok) return { ok: true };

  console.error('[session broker] wake failed', fired.error);
  const { error } = await deps.core.from('session_messages').insert({
    user_id: deps.userId,
    thread_id: deps.threadId,
    author: 'session',
    kind: 'status',
    body: `Not passed on yet: the session could not be woken (${fired.error}). Send again to retry.`.slice(0, 2000),
  });
  if (error) console.error('[session broker] could not note the failed wake', error.message);
  return { ok: false, error: fired.error };
}
