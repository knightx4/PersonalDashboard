import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { dashBackupRoutine, fireFeatureRoutine } from '@/lib/feedback/routine';
import { keepSessionHandoff, markHandoffFired, type SessionHandoff } from './handoffs';
import { startSessionHandoff, type SessionAsker, type SessionHandoffPorts, type SessionStarter } from './session-handoff';

/**
 * The hand-to-a-session action bound to the person's own core client, so
 * RLS keeps the row to theirs, and to the Dash backup routine (plan
 * #3005.2). The bots' reply code is handed `sessionStarter`; Ask Dash keeps
 * its rows through `keepSessionHandoff` and starts them once its answer is
 * kept (lib/talk/ask-request.ts).
 */

/** Whether a session can be started on this deployment: the backup routine has an id and a token. */
export function canHandToSession(): boolean {
  const routine = dashBackupRoutine();
  return Boolean(routine.id && routine.token);
}

/**
 * The turn the routine is started with for a bot's hand-off. The skill reads
 * everything else from the row by its id. The run path (plan #3005.3) owns
 * what a session does with it; this names the row, whose it is and where.
 */
export function sessionLaunchBrief(handoff: Pick<SessionHandoff, 'id' | 'request'>, asker: SessionAsker, userId: string): string {
  const thread =
    asker.thread.kind === 'ask' ? `conversation ${asker.thread.conversationId}` : `chat ${asker.thread.chatId}`;
  return [`Hand-off ${handoff.id}`, `user_id ${userId}`, thread, `bot ${asker.botName}`, '', `Request: ${handoff.request}`].join('\n');
}

export function sessionHandoffPorts(core: CoreSupabaseClient, userId: string): SessionHandoffPorts<SessionHandoff> {
  const routine = dashBackupRoutine();
  return {
    keep: (input) => keepSessionHandoff(core, userId, input),
    async launch(handoff, asker) {
      const fired = await fireFeatureRoutine({
        apiKey: routine.token,
        routineId: routine.id,
        text: sessionLaunchBrief(handoff, asker, userId),
      });
      // Marked failed when it would not start, so the thread is told rather than left waiting.
      await markHandoffFired(core, handoff.id, fired);
      return fired.ok ? { ok: true } : { ok: false, error: fired.error };
    },
  };
}

/**
 * The starter a bot's reply is handed, or null when no session can be
 * started here. People offers it on the owner's account alone, as it does
 * pages (plan #2997), since the routine writes through scripts/sql.ts.
 */
export function sessionStarter(core: CoreSupabaseClient, userId: string): SessionStarter | null {
  if (!canHandToSession()) return null;
  const ports = sessionHandoffPorts(core, userId);
  return async (asker, input, seen) => (await startSessionHandoff(ports, asker, input, seen)).told;
}
