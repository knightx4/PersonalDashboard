import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  DECISION_MAX,
  MEETING_RUNNING_MESSAGE,
  MEETING_STALE_AFTER_MS,
  STALE_MEETING_ERROR,
} from '@/lib/you/board';

/**
 * Call a board meeting about one decision (plan #2540.5), as Look again starts
 * an insights run (lib/you/insights-start.ts): a row the tab shows running at
 * once, then the board routine fired with a brief naming it.
 */

export const BOARD_SKILL_PATH = '.claude/skills/board/SKILL.md';

/** The decision as one line, or null when nothing is left of it. */
export function cleanDecision(text: string): string | null {
  const line = text.replace(/\s+/g, ' ').trim();
  return line ? line : null;
}

/** The brief the routine is fired with, in the shape the board skill reads. */
export function boardBrief(input: { meetingId: string; userId: string; decision: string }): string {
  return [
    `Follow ${BOARD_SKILL_PATH}`,
    `Board meeting ${input.meetingId}`,
    `user_id ${input.userId}`,
    `called: ${input.decision}`,
  ].join('\n');
}

export type CallBoardMeetingResult =
  | { started: true; meetingId: string }
  | { started: false; reason: 'invalid' | 'running' | 'no_routine' | 'error'; error: string };

/**
 * Queue a called meeting and fire the board routine for it. A meeting left
 * queued or running past the stale mark is marked failed first, so a session
 * that died does not hold the next one; the partial unique index allows one
 * open meeting at a time. A fire that fails marks the new row failed with the
 * answer, which is what the tab then shows.
 *
 * `client` is the person's own session or the service role; every query names
 * the user.
 */
export async function callBoardMeeting(input: {
  client: YouSupabaseClient;
  userId: string;
  decision: string;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<CallBoardMeetingResult> {
  const { client, userId, routine } = input;
  const decision = cleanDecision(input.decision);
  if (!decision) return { started: false, reason: 'invalid', error: 'Say what the decision is first.' };
  if (decision.length > DECISION_MAX) {
    return {
      started: false,
      reason: 'invalid',
      error: `Keep the decision to one line of at most ${DECISION_MAX} characters.`,
    };
  }
  if (!routine.id || !routine.token) {
    return {
      started: false,
      reason: 'no_routine',
      error:
        'Board meetings run on the board routine, which is not set up on this deployment: it needs CLAUDE_BOARD_ROUTINE_ID and CLAUDE_BOARD_ROUTINE_TOKEN.',
    };
  }

  const now = input.now ?? Date.now();
  await client
    .from('board_meetings')
    .update({ status: 'failed', error: STALE_MEETING_ERROR, finished_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .lt('requested_at', new Date(now - MEETING_STALE_AFTER_MS).toISOString());

  const { data: row, error } = await client
    .from('board_meetings')
    .insert({ user_id: userId, kind: 'called', decision, status: 'queued' })
    .select('id')
    .single();
  if (error?.code === '23505') return { started: false, reason: 'running', error: MEETING_RUNNING_MESSAGE };
  if (error || !row) {
    return { started: false, reason: 'error', error: error?.message ?? 'Could not call the meeting.' };
  }
  const meetingId = row.id as string;

  const fired = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: boardBrief({ meetingId, userId, decision }),
    fetch: input.fetch,
  });

  if (!fired.ok) {
    await client
      .from('board_meetings')
      .update({
        status: 'failed',
        error: `Dash could not start the meeting. ${fired.error}`.slice(0, 2000),
        finished_at: new Date(now).toISOString(),
      })
      .eq('id', meetingId)
      .eq('user_id', userId);
    return { started: false, reason: 'error', error: fired.error };
  }

  const body = fired.body as Record<string, unknown> | null;
  const runUrl = typeof body?.claude_code_session_url === 'string' ? body.claude_code_session_url : null;
  if (runUrl) {
    await client
      .from('board_meetings')
      .update({ run_url: runUrl.slice(0, 500) })
      .eq('id', meetingId)
      .eq('user_id', userId);
  }
  return { started: true, meetingId };
}
