/**
 * A cover letter, queued for the routine (job_search 0084).
 *
 * The Draft button writes a row in job_search.cover_letter_requests and fires
 * the goals routine with a brief whose first line hands the session to
 * .claude/skills/cover-letters/SKILL.md. That skill writes the letter with the
 * person's cover letter skill and saves it through scripts/cover-letter.ts,
 * which marks the row done. The tab polls the row until then.
 *
 * Pure apart from the client it is handed, so the press, the script and the
 * tests share it.
 */
import type { JobsClient } from './gather';
import { saveReplies } from './store';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { FireRoutineResult } from '@/lib/feedback/routine';

const TABLE = 'cover_letter_requests';

export type LetterRequestStatus = 'queued' | 'drafting' | 'done' | 'failed';

export type LetterRequest = {
  id: string;
  applicationId: string;
  status: LetterRequestStatus;
  error: string | null;
  requestedAt: string;
};

export const LETTER_REQUEST_COLUMNS = 'id, application_id, status, error, requested_at';

/**
 * How long a request may stay open before it is taken as dead. A letter takes
 * the session a few minutes; one open for an hour stopped without saving, and
 * the next press starts again rather than waiting on it.
 */
export const LETTER_STALE_MS = 60 * 60 * 1000;

/** The first line of the brief; the goals skill hands the session to this skill. */
export const LETTER_SKILL_LINE = 'Follow .claude/skills/cover-letters/SKILL.md';

/** The brief the goals routine is fired with. The skill reads everything else through the script. */
export function letterBrief(input: { requestId: string; userId: string; applicationId: string }): string {
  return [
    LETTER_SKILL_LINE,
    `Cover letter ${input.requestId}`,
    `user_id ${input.userId}`,
    `application ${input.applicationId}`,
  ].join('\n');
}

export function readLetterRequest(row: Record<string, unknown>): LetterRequest {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    status: row.status as LetterRequestStatus,
    error: typeof row.error === 'string' ? row.error : null,
    requestedAt: String(row.requested_at),
  };
}

/** The newest request on an application, or null when the letter was never queued. */
export async function latestLetterRequest(
  jobs: JobsClient,
  userId: string,
  applicationId: string,
): Promise<LetterRequest | null> {
  const { data } = await jobs
    .from(TABLE)
    .select(LETTER_REQUEST_COLUMNS)
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? readLetterRequest(data as Record<string, unknown>) : null;
}

/** Whether a request is still being worked: open and younger than the stale mark. */
export function letterRequestOpen(request: LetterRequest | null, now = Date.now()): boolean {
  if (!request) return false;
  if (request.status !== 'queued' && request.status !== 'drafting') return false;
  return now - Date.parse(request.requestedAt) < LETTER_STALE_MS;
}

export type QueueLetterResult =
  | { ok: true; requestId: string; already: boolean }
  | { ok: false; error: string };

export type QueueLetterDeps = {
  jobs: JobsClient;
  /** Fires the goals routine with the brief; absent in tests that only queue. */
  fire: (brief: string) => Promise<FireRoutineResult>;
};

/**
 * Queue the letter and start the routine. Replies given are stored first, so
 * the routine's prompt carries them. A press while one is open returns that
 * one. A routine that would not start marks the new row failed with why.
 */
export async function queueCoverLetter(
  deps: QueueLetterDeps,
  input: { userId: string; applicationId: string; replies?: Record<string, string> },
): Promise<QueueLetterResult> {
  const { jobs, fire } = deps;
  const { userId, applicationId } = input;

  const { data: application } = await jobs
    .from('applications')
    .select('id')
    .eq('id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!application) return { ok: false, error: 'That application is not yours.' };

  if (input.replies && Object.keys(input.replies).length > 0) {
    const saved = await saveReplies(jobs as unknown as AppSupabaseClient, applicationId, 'cover_letter', input.replies);
    if (saved.error) return { ok: false, error: saved.error };
  }

  // A session that died leaves its row open; close it so this press can start.
  await jobs
    .from(TABLE)
    .update({ status: 'failed', error: 'The run stopped without finishing.', finished_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .in('status', ['queued', 'drafting'])
    .lt('requested_at', new Date(Date.now() - LETTER_STALE_MS).toISOString());

  const { data: row, error } = await jobs
    .from(TABLE)
    .insert({ user_id: userId, application_id: applicationId, status: 'queued' })
    .select('id')
    .single();
  if (error?.code === '23505') {
    const open = await latestLetterRequest(jobs, userId, applicationId);
    if (open && letterRequestOpen(open)) return { ok: true, requestId: open.id, already: true };
    return { ok: false, error: 'A letter is already being drafted.' };
  }
  if (error || !row) return { ok: false, error: error?.message ?? 'Could not queue the letter.' };
  const requestId = (row as { id: string }).id;

  const fired = await fire(letterBrief({ requestId, userId, applicationId }));
  if (!fired.ok) {
    await jobs
      .from(TABLE)
      .update({ status: 'failed', error: `Dash could not start the routine. ${fired.error}`, finished_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('user_id', userId);
    return { ok: false, error: fired.error };
  }
  const body = fired.body as Record<string, unknown> | null;
  const runUrl = typeof body?.claude_code_session_url === 'string' ? body.claude_code_session_url : null;
  if (runUrl) await jobs.from(TABLE).update({ run_url: runUrl }).eq('id', requestId).eq('user_id', userId);
  return { ok: true, requestId, already: false };
}

/** Mark a request as being written (the script's `show`), done (`save`) or given up (`fail`). */
export async function settleLetterRequest(
  jobs: JobsClient,
  userId: string,
  requestId: string,
  change: { status: 'drafting' } | { status: 'done' } | { status: 'failed'; error: string },
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const patch =
    change.status === 'drafting'
      ? { status: 'drafting', taken_at: now }
      : change.status === 'done'
        ? { status: 'done', error: null, finished_at: now }
        : { status: 'failed', error: change.error, finished_at: now };
  const { error } = await jobs.from(TABLE).update(patch).eq('id', requestId).eq('user_id', userId);
  return { error: error ? error.message : null };
}
