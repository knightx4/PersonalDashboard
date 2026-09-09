/**
 * Fire a Claude Code routine, and say which one each button pulls.
 *
 * A routine normally runs on a schedule. Firing it is the manual pull on the
 * same rope, so a note filed this minute does not have to wait for tonight.
 *
 * There are two ropes, because there are two queues. The notes routine reads
 * feedback_items and ships the fixes; the plan routine works plan_items, one
 * step at a time, and shapes an idea into a proposal. They were one routine
 * once, which is why one id served every button -- and why a single id is now
 * wrong: the bugs page sends no text at all, so a button pointed at the wrong
 * routine does not fail, it quietly works the other queue.
 *
 * Hence a variable per queue, each falling back to the old shared one and then
 * to the built-in default, so a deployment that sets neither behaves exactly as
 * it did before. The ids are not secrets; they are overridable so a routine can
 * be repointed without a deploy.
 *
 * The bearer token is a secret, and it is scoped to the routine rather than to
 * the account: firing one routine with another's token answers "401 Token is
 * not authorized for this routine". So it splits the same way, and id and token
 * are handed out together as a pair -- a repointed id whose token stayed behind
 * is the whole failure this shape exists to prevent.
 */
import 'server-only';

export const DEFAULT_FEATURE_ROUTINE_ID = 'trig_018TQKkc6qbGLmP1Y7AKWn4N';

/** The first of these actually set to something. Blank is not an answer. */
function firstSet(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * A routine and the token that may fire it.
 *
 * The two travel together because the token is scoped to the routine, not to
 * the account: firing one routine with another's token answers
 * "401 Token is not authorized for this routine". Returning them as a pair is
 * what stops an id being repointed without its token following.
 */
export type RoutineTarget = { id: string | null; token: string | null };

/** The routine that works the notes queue -- "Run Feature Routine". */
export function notesRoutine(): RoutineTarget {
  return {
    id: firstSet(process.env.CLAUDE_NOTES_ROUTINE_ID, process.env.CLAUDE_FEATURE_ROUTINE_ID),
    token: firstSet(process.env.CLAUDE_NOTES_ROUTINE_TOKEN, process.env.CLAUDE_API_KEY),
  };
}

/** The routine that works the plan -- "Send to Claude" and "Shape into a plan". */
export function planRoutine(): RoutineTarget {
  return {
    id: firstSet(process.env.CLAUDE_PLAN_ROUTINE_ID, process.env.CLAUDE_FEATURE_ROUTINE_ID),
    token: firstSet(process.env.CLAUDE_PLAN_ROUTINE_TOKEN, process.env.CLAUDE_API_KEY),
  };
}

/** The beta header the routine API requires, as documented. */
const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';
const ANTHROPIC_VERSION = '2023-06-01';

export type FireRoutineResult =
  | { ok: true; detail: string }
  | { ok: false; error: string };

export async function fireFeatureRoutine(options: {
  apiKey: string | null;
  routineId?: string | null;
  /** Optional extra turn appended to the routine's session. */
  text?: string | null;
  fetch?: typeof globalThis.fetch;
}): Promise<FireRoutineResult> {
  if (!options.apiKey) {
    return {
      ok: false,
      error:
        'No token for this routine on the deployment, so it cannot be started. ' +
        'Set CLAUDE_PLAN_ROUTINE_TOKEN or CLAUDE_NOTES_ROUTINE_TOKEN (or CLAUDE_API_KEY for both).',
    };
  }

  const routineId = options.routineId?.trim() || DEFAULT_FEATURE_ROUTINE_ID;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = `https://api.anthropic.com/v1/claude_code/routines/${routineId}/fire`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ROUTINE_BETA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options.text?.trim() ? { text: options.text.trim() } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The request never reached Anthropic.',
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, error: `Anthropic answered ${response.status}. ${summarize(body)}`.trim() };
  }

  return { ok: true, detail: 'The routine is running. Its commits will land on their own.' };
}

/** The useful half of an error body, short enough to put in a toast. */
function summarize(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return trimmed.slice(0, 200);
}
