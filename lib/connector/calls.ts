import type { AskToolResult, SchemaClient } from '@/lib/ask/db';
import type { TalkCitation } from '@/lib/talk/talk';

/**
 * The log of what a connected Claude app read, and the cap on how often it may
 * call (plan #1254). Every tool call through the connector is one row in
 * core.connector_calls (supabase/migrations/0133_connector_calls.sql), and the
 * cap is counted from those rows, so there is no second counter to drift.
 *
 * No client is made here: each function takes a supabase-js client bound to
 * the core schema, so the route can pass whichever one it holds and the tests
 * a stub.
 */

/** Calls a person's connected apps may make, together. A starting guess: Ask Dash makes a few a question. */
export const CONNECTOR_RATE = {
  perMinute: 30,
  perDay: 1000,
} as const;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How a call ended: answered, refused or failed by the lookup, or refused by the cap before it ran. */
export type ConnectorOutcome = 'ok' | 'error' | 'limited';

export type ConnectorCall = {
  userId: string;
  /** The token's client_id claim. */
  clientId: string;
  /** What the client registered as, when the caller knows it. */
  clientName?: string | null;
  tool: string;
  /** The arguments the client sent. Anything that is not an object is stored as {}. */
  input: unknown;
} & (
  | { result: AskToolResult }
  /** The cap refused the call; `error` is the message the client was given. */
  | { limited: string }
);

/** The row a call is stored as. `reads` is one {table, ref, title, href} per row returned. */
export type ConnectorCallRow = {
  user_id: string;
  client_id: string;
  client_name: string | null;
  tool: string;
  input: Record<string, unknown>;
  reads: TalkCitation[];
  outcome: ConnectorOutcome;
  error: string | null;
};

export function connectorCallRow(call: ConnectorCall): ConnectorCallRow {
  const input =
    call.input && typeof call.input === 'object' && !Array.isArray(call.input)
      ? (call.input as Record<string, unknown>)
      : {};
  const base = {
    user_id: call.userId,
    client_id: call.clientId,
    client_name: call.clientName ?? null,
    tool: call.tool,
    input,
  };
  if ('limited' in call) return { ...base, reads: [], outcome: 'limited', error: call.limited };
  const { result } = call;
  if (!result.ok) return { ...base, reads: [], outcome: 'error', error: result.error };
  return {
    ...base,
    reads: result.rows.map(({ table, ref, title, href }) => ({ table, ref, title, href })),
    outcome: 'ok',
    error: null,
  };
}

/** Write one call to the log. Throws when the insert fails, so a call is never answered unrecorded by accident. */
export async function recordConnectorCall(core: SchemaClient, call: ConnectorCall): Promise<void> {
  const { error } = await core.from('connector_calls').insert(connectorCallRow(call));
  if (error) throw new Error(`Could not record the connector call: ${error.message}`);
}

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

/** What one window of the cap found: how many calls, and when the one that fills it was made. */
export type RateWindow = {
  count: number;
  /** The `limit`-th newest call's time, when there are at least that many. */
  filledAt: string | null;
};

export type RateVerdict =
  | { ok: true }
  | {
      ok: false;
      limit: 'minute' | 'day';
      /** When the next call will be let through. */
      retryAt: string;
      /** Whole seconds until then, at least one; for a Retry-After header. */
      retryAfterSeconds: number;
      /** What the client is told, saying when it can try again. */
      message: string;
    };

function wait(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/**
 * Whether the next call is within the cap, from what the two windows found.
 * A full window refuses until its `limit`-th newest call falls out of it; when
 * both are full, the later of the two is when a call will go through.
 */
export function rateVerdict(windows: { minute: RateWindow; day: RateWindow }, now: number): RateVerdict {
  const refusals = (
    [
      ['minute', windows.minute, CONNECTOR_RATE.perMinute, MINUTE_MS],
      ['day', windows.day, CONNECTOR_RATE.perDay, DAY_MS],
    ] as const
  )
    .filter(([, w, limit]) => w.count >= limit)
    .map(([limit, w, , span]) => {
      // Without the filling call's time, wait out the whole window.
      const filled = w.filledAt ? Date.parse(w.filledAt) : now;
      return { limit, at: Math.max(now + 1000, filled + span) };
    })
    .sort((a, b) => b.at - a.at);

  const worst = refusals[0];
  if (!worst) return { ok: true };

  const retryAfterSeconds = Math.max(1, Math.ceil((worst.at - now) / 1000));
  const allowed =
    worst.limit === 'minute'
      ? `${CONNECTOR_RATE.perMinute} calls a minute`
      : `${CONNECTOR_RATE.perDay.toLocaleString('en-US')} calls a day`;
  return {
    ok: false,
    limit: worst.limit,
    retryAt: new Date(worst.at).toISOString(),
    retryAfterSeconds,
    message: `Too many calls: the dashboard answers at most ${allowed} from connected apps. Try again in ${wait(retryAfterSeconds)}.`,
  };
}

async function countWindow(
  core: SchemaClient,
  userId: string,
  since: number,
  limit: number,
): Promise<RateWindow> {
  const from = new Date(since).toISOString();
  const counted = await core
    .from('connector_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('outcome', 'limited')
    .gte('created_at', from);
  if (counted.error) throw new Error(`Could not count connector calls: ${counted.error.message}`);
  const count = counted.count ?? 0;
  if (count < limit) return { count, filledAt: null };

  // Full: find the call that filled it, since the window reopens when that one leaves.
  // Asked for only now, because PostgREST refuses an offset past the last row.
  const filled = await core
    .from('connector_calls')
    .select('created_at')
    .eq('user_id', userId)
    .neq('outcome', 'limited')
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .range(limit - 1, limit - 1);
  if (filled.error) throw new Error(`Could not count connector calls: ${filled.error.message}`);
  const row = (filled.data as { created_at: string }[] | null)?.[0];
  return { count, filledAt: row?.created_at ?? null };
}

/**
 * Whether this person's next connector call is within the cap. Counts the
 * calls that ran (not those the cap already refused) across all their
 * connected apps, over the last minute and the last day.
 */
export async function checkConnectorRate(
  core: SchemaClient,
  userId: string,
  now: number = Date.now(),
): Promise<RateVerdict> {
  const [minute, day] = await Promise.all([
    countWindow(core, userId, now - MINUTE_MS, CONNECTOR_RATE.perMinute),
    countWindow(core, userId, now - DAY_MS, CONNECTOR_RATE.perDay),
  ]);
  return rateVerdict({ minute, day }, now);
}

// ---------------------------------------------------------------------------
// Revocations
// ---------------------------------------------------------------------------

/** Record that the person removed a connected app, so tokens it already holds stop working. */
export async function recordConnectorRevocation(
  core: SchemaClient,
  userId: string,
  clientId: string,
): Promise<void> {
  const { error } = await core
    .from('connector_revocations')
    .insert({ user_id: userId, client_id: clientId });
  if (error) throw new Error(`Could not record the revocation: ${error.message}`);
}

/** When the person last removed this app, or null if never. A token issued before it is refused. */
export async function lastConnectorRevocation(
  core: SchemaClient,
  userId: string,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await core
    .from('connector_revocations')
    .select('revoked_at')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .order('revoked_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read revocations: ${error.message}`);
  return (data as { revoked_at: string }[] | null)?.[0]?.revoked_at ?? null;
}
