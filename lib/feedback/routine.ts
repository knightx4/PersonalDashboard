/**
 * Fire the Claude Code routine that works this queue.
 *
 * The notes loop normally runs on a schedule. This is the manual pull on the
 * same rope: it starts the routine that reads feedback_items and ships the
 * fixes, so a note filed this minute does not have to wait for tonight.
 *
 * The trigger id is the one the user set up; it is not a secret (the bearer
 * token is), and it is overridable so a second routine can be pointed at
 * without a deploy.
 */
import 'server-only';

export const DEFAULT_FEATURE_ROUTINE_ID = 'trig_018TQKkc6qbGLmP1Y7AKWn4N';

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
