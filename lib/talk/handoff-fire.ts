import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { dashBackupRoutine, fireFeatureRoutine, type FireRoutineResult, type RoutineTarget } from '@/lib/feedback/routine';
import type { HandoffState } from './handoff';
import { sessionHandoffBrief } from './handoff-session';
import type { SessionHandoff } from './handoffs';

/**
 * Starting a Claude Code session on a session hand-off (plan #3005.3), on the
 * Dash backup routine's path (plan #1402): the same routine and token, fired
 * with the hand-off's brief. The routine runs as Claude Code, not on the API.
 *
 * The row is claimed before the routine is fired: pending becomes fired
 * (state running) only where it is still pending, so two callers holding the
 * same row start one session between them. A fire that fails marks it
 * failed with Anthropic's reason and as told: the turn that handed it on
 * says it did not get passed on (startHandoffs in lib/dash/ask.ts, notHandedOn
 * in lib/talk/session-handoff.ts), so the watch (you.watch_bot_pages) does
 * not say it a second time.
 */

export type FireSessionDeps = {
  routine?: () => RoutineTarget;
  fire?: (options: { apiKey: string | null; routineId?: string | null; text?: string | null }) => Promise<FireRoutineResult>;
  now?: () => Date;
};

/** Said on the row when this deployment has no backup routine to start. */
export const NO_SESSION_ROUTINE =
  'No Claude Code routine is set up for hand-offs on this deployment (CLAUDE_DASH_BACKUP_ROUTINE_ID and CLAUDE_DASH_BACKUP_ROUTINE_TOKEN).';

export async function fireSessionHandoff(
  core: Pick<CoreSupabaseClient, 'from'>,
  userId: string,
  handoff: SessionHandoff,
  deps: FireSessionDeps = {},
): Promise<{ state: HandoffState; runId: string | null; error: string | null }> {
  if (handoff.state !== 'queued') return { state: handoff.state, runId: handoff.runId, error: handoff.error };
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const routine = (deps.routine ?? dashBackupRoutine)();

  if (!routine.id || !routine.token) {
    await finish(core, userId, handoff.id, NO_SESSION_ROUTINE, now, 'pending');
    return { state: 'failed', runId: null, error: NO_SESSION_ROUTINE };
  }

  const { data: claimed, error: claimError } = await core
    .from('dash_handoffs')
    .update({ status: 'fired', fired_at: now, last_seen_at: now })
    .eq('id', handoff.id)
    .eq('user_id', userId)
    .eq('kind', 'session')
    .eq('status', 'pending')
    .select('id');
  if (claimError) throw new Error(`Starting the hand-off failed: ${claimError.message}`);
  // Another caller claimed it first and is starting the session.
  if (!claimed || claimed.length === 0) return { state: 'running', runId: null, error: null };

  const fired = await (deps.fire ?? fireFeatureRoutine)({
    apiKey: routine.token,
    routineId: routine.id,
    text: sessionHandoffBrief(handoff, userId),
  });
  if (!fired.ok) {
    const reason = `The session could not be started: ${fired.error}`.slice(0, 1000);
    await finish(core, userId, handoff.id, reason, now, 'fired');
    return { state: 'failed', runId: null, error: reason };
  }
  if (fired.runId) {
    const { error } = await core
      .from('dash_handoffs')
      .update({ run_id: fired.runId })
      .eq('id', handoff.id)
      .eq('user_id', userId);
    if (error) console.error('the hand-off run id was not kept', error.message);
  }
  return { state: 'running', runId: fired.runId, error: null };
}

async function finish(
  core: Pick<CoreSupabaseClient, 'from'>,
  userId: string,
  id: string,
  reason: string,
  now: string,
  from: 'pending' | 'fired',
): Promise<void> {
  const { error } = await core
    .from('dash_handoffs')
    .update({ status: 'failed', error: reason, finished_at: now, told_at: now })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', from);
  if (error) console.error('the hand-off was not marked failed', error.message);
}
