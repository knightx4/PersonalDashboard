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
 * it did before. The ids are not secrets (the bearer token is); they are
 * overridable so a routine can be repointed without a deploy.
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

/** The routine that works the notes queue -- "Run Feature Routine". */
export function notesRoutineId(): string | null {
  return firstSet(process.env.CLAUDE_NOTES_ROUTINE_ID, process.env.CLAUDE_FEATURE_ROUTINE_ID);
}

/** The routine that works the plan -- "Send to Claude" and "Shape into a plan". */
export function planRoutineId(): string | null {
  return firstSet(process.env.CLAUDE_PLAN_ROUTINE_ID, process.env.CLAUDE_FEATURE_ROUTINE_ID);
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
      error: 'CLAUDE_API_KEY is not set on this deployment, so the routine cannot be started.',
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
