import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { dashBackupRoutine } from '@/lib/feedback/routine';
import { fireSessionHandoff } from './handoff-fire';
import { keepSessionHandoff, type SessionHandoff } from './handoffs';
import { startSessionHandoff, type SessionHandoffPorts, type SessionStarter } from './session-handoff';

/**
 * The hand-to-a-session action bound to the person's own core client, so
 * RLS keeps the row to theirs, and to the Dash backup routine (plan
 * #3005.2). The bots' reply code is handed `sessionStarter`; Ask Dash keeps
 * its rows through `keepSessionHandoff` and starts them once its answer is
 * kept (lib/talk/ask-request.ts). Both start a session the same way, through
 * fireSessionHandoff (lib/talk/handoff-fire.ts).
 */

/** Whether a session can be started on this deployment: the backup routine has an id and a token. */
export function canHandToSession(): boolean {
  const routine = dashBackupRoutine();
  return Boolean(routine.id && routine.token);
}

export function sessionHandoffPorts(core: CoreSupabaseClient, userId: string): SessionHandoffPorts<SessionHandoff> {
  return {
    keep: (input) => keepSessionHandoff(core, userId, input),
    async launch(handoff) {
      // A refused start marks the row failed, so the thread is told rather than left waiting.
      const started = await fireSessionHandoff(core, userId, handoff);
      return started.state === 'failed'
        ? { ok: false, error: started.error ?? 'the session could not be started.' }
        : { ok: true };
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
