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

/** The routine that works the plan -- "Send to Dash" and "Shape into a plan". */
export function planRoutine(): RoutineTarget {
  return {
    id: firstSet(process.env.CLAUDE_PLAN_ROUTINE_ID, process.env.CLAUDE_FEATURE_ROUTINE_ID),
    token: firstSet(process.env.CLAUDE_PLAN_ROUTINE_TOKEN, process.env.CLAUDE_API_KEY),
  };
}

/**
 * The routine that reviews one module's interface -- the button on
 * /dev/ui/review.
 *
 * No fallback to the shared id, unlike the two above. A review pass is a
 * different job from working the notes queue and from building the plan, and a
 * button pointed at either of those would not fail: it would quietly work the
 * wrong queue, which is the failure the split ids exist to prevent. With no id
 * set the page says so and starts nothing.
 */
export function reviewRoutine(): RoutineTarget {
  return {
    id: firstSet(process.env.CLAUDE_REVIEW_ROUTINE_ID),
    token: firstSet(process.env.CLAUDE_REVIEW_ROUTINE_TOKEN, process.env.CLAUDE_API_KEY),
  };
}

/** The beta header the routine API requires, as documented. */
const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * What a press produced, kept rather than reduced to a sentence.
 *
 * The result used to be a message for the toast and nothing else, so the app
 * threw away the only evidence it ever gets that a run exists. `body` is what
 * Anthropic answered with -- parsed when it is JSON, the raw text when it is
 * not, null when there was none -- and `runId` is whatever in it looks like a
 * name for the run. Both are recorded by `lib/plan/runs.ts`; a failure carries
 * them too, because the body of a refusal is the half that says why.
 */
export type FireRoutineResult =
  | { ok: true; detail: string; status: number; body: unknown; runId: string | null }
  | { ok: false; error: string; status: number | null; body: unknown };

/** The keys a run's own identifier has turned up under, most specific first. */
const RUN_ID_KEYS = [
  'claude_code_session_id',
  'run_id',
  'routine_run_id',
  'session_id',
  'conversation_id',
  'id',
] as const;

/** Where an identifier hides when the body wraps it, rather than at the top. */
const RUN_ID_CONTAINERS = ['run', 'routine_run', 'session', 'data', 'result'] as const;

/**
 * The identifier of the run that was just started, if the body carries one.
 *
 * The real body is now known, from the rows #498 started keeping:
 * `{"type": "routine_fire", "claude_code_session_id": "cse_...",
 * "claude_code_session_url": "https://claude.ai/code/cse_..."}`. So
 * `claude_code_session_id` is read first, and the keys below it stay because
 * they cost nothing and the endpoint is a beta whose shape may move.
 *
 * Null rather than a guess when none of them is there. The body is recorded
 * beside the id, so a shape this misses is a question of reading the stored
 * row, not of firing another run to find out.
 */
export function runIdFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;

  for (const key of RUN_ID_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  for (const container of RUN_ID_CONTAINERS) {
    const nested = record[container];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const key of RUN_ID_KEYS) {
        const value = (nested as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  }

  return null;
}

/**
 * The routine a press actually fires: the one set, or the built-in default.
 *
 * Exported because the run record names the routine that took the work, and
 * recording the unset id rather than the one the request went to would make the
 * record wrong in exactly the case it exists for.
 */
export function resolveRoutineId(routineId?: string | null): string {
  return routineId?.trim() || DEFAULT_FEATURE_ROUTINE_ID;
}

/** The response body as something storable: JSON when it parses, else the text. */
function bodyOf(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Not JSON. The text is still evidence, and still worth keeping.
    return trimmed.slice(0, 4000);
  }
}

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
      status: null,
      body: null,
    };
  }

  const routineId = resolveRoutineId(options.routineId);
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
      status: null,
      body: null,
    };
  }

  const text = await response.text().catch(() => '');
  const body = bodyOf(text);

  if (!response.ok) {
    return {
      ok: false,
      error: `Anthropic answered ${response.status}. ${summarize(text)}`.trim(),
      status: response.status,
      body,
    };
  }

  return {
    ok: true,
    detail: 'The routine is running. Its commits will land on their own.',
    status: response.status,
    body,
    runId: runIdFrom(body),
  };
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
