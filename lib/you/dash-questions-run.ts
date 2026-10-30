import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The run that has Dash write new questions for the Answer tab of You (plan
 * #2617.3), modelled on the Insights run (lib/you/insights-start.ts).
 *
 * The button on the tab queues a you.dash_question_runs row, then fires the
 * goals routine with a brief naming it. The session follows
 * .claude/skills/dash-questions/SKILL.md: it reads the person's notes, goals,
 * details and every earlier question, and writes at most five new open ones
 * under the run (a trigger refuses a sixth, you 0034). One run at a time: the
 * partial unique index refuses a second press while one is queued or running.
 */

export const DASH_QUESTIONS_SKILL_PATH = '.claude/skills/dash-questions/SKILL.md';

/** The most questions one run adds; the table's trigger holds to the same. */
export const QUESTIONS_PER_RUN = 5;

/**
 * A run still queued or running this long after it was asked for has
 * stopped: the tab shows it failed, and the next press marks it failed before
 * checking for one in progress. Shorter than the Insights run's three hours,
 * since this one reads less.
 */
export const QUESTION_RUN_STALE_AFTER_MS = 90 * 60 * 1000;

/** What the stale check writes into a run that stopped without saying so. */
export const STALE_QUESTION_RUN_ERROR = 'Dash stopped before it finished writing questions. Try again.';

export type DashQuestionRunStatus = 'queued' | 'running' | 'ready' | 'failed';

export type DashQuestionRun = {
  id: string;
  status: DashQuestionRunStatus;
  summary: string | null;
  error: string | null;
  runUrl: string | null;
  requestedAt: string;
  finishedAt: string | null;
};

const STATUSES: readonly DashQuestionRunStatus[] = ['queued', 'running', 'ready', 'failed'];
export const QUESTION_RUN_COLUMNS = 'id, status, summary, error, run_url, requested_at, finished_at';

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A dash_question_runs row; an unknown status reads as failed, a link that is not https as none. */
export function questionRunFromRow(row: Record<string, unknown>): DashQuestionRun {
  const status = STATUSES.find((s) => s === row.status) ?? 'failed';
  const url = text(row.run_url);
  return {
    id: String(row.id ?? ''),
    status,
    summary: text(row.summary),
    error: text(row.error),
    runUrl: url && url.startsWith('https://') ? url : null,
    requestedAt: String(row.requested_at ?? ''),
    finishedAt: text(row.finished_at),
  };
}

/** What the tab shows about the newest run. */
export type QuestionRunState =
  | { kind: 'none' }
  | { kind: 'running'; run: DashQuestionRun }
  | { kind: 'failed'; run: DashQuestionRun; error: string }
  | { kind: 'ready'; run: DashQuestionRun };

/** The newest run as the tab draws it; one queued or running past the stale mark reads as failed. */
export function questionRunState(run: DashQuestionRun | null, now: number = Date.now()): QuestionRunState {
  if (!run) return { kind: 'none' };
  if (run.status === 'queued' || run.status === 'running') {
    const asked = new Date(run.requestedAt).getTime();
    if (Number.isFinite(asked) && now - asked > QUESTION_RUN_STALE_AFTER_MS) {
      return { kind: 'failed', run, error: STALE_QUESTION_RUN_ERROR };
    }
    return { kind: 'running', run };
  }
  if (run.status === 'failed') {
    return { kind: 'failed', run, error: run.error ?? 'Dash did not finish writing questions. Try again.' };
  }
  return { kind: 'ready', run };
}

/** Their newest run, or null before the first. */
export async function latestQuestionRun(client: YouSupabaseClient, userId: string): Promise<DashQuestionRun | null> {
  const { data, error } = await client
    .from('dash_question_runs')
    .select(QUESTION_RUN_COLUMNS)
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading Dash's question runs failed: ${error.message}`);
  return data ? questionRunFromRow(data as Record<string, unknown>) : null;
}

/**
 * The brief the goals routine is fired with. Its first line hands the session
 * to the skill (the goals skill, "Jobs that follow another skill"); the skill
 * reads everything else by the ids here.
 */
export function dashQuestionsBrief(input: { runId: string; userId: string }): string {
  return [`Follow ${DASH_QUESTIONS_SKILL_PATH}`, `Question run ${input.runId}`, `user_id ${input.userId}`].join('\n');
}

export type StartQuestionRunResult =
  | { started: true; runId: string }
  | { started: false; reason: 'running' | 'no_routine' | 'error'; error: string };

/**
 * Start one run: mark a run left past the stale mark failed, queue the row
 * (refused while another is open), then fire the goals routine with the
 * brief. A fire that fails marks the new row failed with the answer, which is
 * what the tab then shows. Every query names the user.
 */
export async function startQuestionRun(input: {
  client: YouSupabaseClient;
  userId: string;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<StartQuestionRunResult> {
  const { client, userId, routine } = input;
  if (!routine.id || !routine.token) {
    return {
      started: false,
      reason: 'no_routine',
      error:
        'Dash writes questions on the goals routine, which is not set up on this deployment: it needs CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN.',
    };
  }
  const now = input.now ?? Date.now();
  await client
    .from('dash_question_runs')
    .update({ status: 'failed', error: STALE_QUESTION_RUN_ERROR, finished_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .lt('requested_at', new Date(now - QUESTION_RUN_STALE_AFTER_MS).toISOString());

  const { data: row, error } = await client
    .from('dash_question_runs')
    .insert({ user_id: userId, status: 'queued' })
    .select('id')
    .single();
  if (error?.code === '23505') {
    return { started: false, reason: 'running', error: 'Dash is already writing questions.' };
  }
  if (error || !row) return { started: false, reason: 'error', error: error?.message ?? 'Could not start the run.' };
  const runId = row.id as string;

  const fired = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: dashQuestionsBrief({ runId, userId }),
    fetch: input.fetch,
  });

  if (!fired.ok) {
    await client
      .from('dash_question_runs')
      .update({
        status: 'failed',
        error: `Dash could not start the run. ${fired.error}`.slice(0, 2000),
        finished_at: new Date(now).toISOString(),
      })
      .eq('id', runId)
      .eq('user_id', userId);
    return { started: false, reason: 'error', error: fired.error };
  }

  const body = fired.body as Record<string, unknown> | null;
  const runUrl = typeof body?.claude_code_session_url === 'string' ? body.claude_code_session_url : null;
  if (runUrl) {
    await client
      .from('dash_question_runs')
      .update({ run_url: runUrl.slice(0, 500) })
      .eq('id', runId)
      .eq('user_id', userId);
  }
  return { started: true, runId };
}
