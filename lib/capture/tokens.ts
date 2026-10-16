import { createHash, randomBytes } from 'node:crypto';
import type { SchemaClient } from '@/lib/ask/db';

/**
 * Personal capture tokens (plan #1705, docs/INPUT-CHANNELS.md).
 *
 * A token lets a Siri Shortcut or another tool add things to the app without
 * a browser sign-in. It is made on the account page and shown once; only its
 * SHA-256 is kept, in core.capture_tokens
 * (supabase/migrations/0191_capture_tokens.sql). It can only add things, and it
 * can be revoked.
 *
 * A token is `dash_` and 43 base64url characters: 32 random bytes. That is
 * enough entropy that a plain SHA-256 is the right hash. A slow password hash
 * protects guessable secrets, and this one is not guessable, while the lookup
 * by hash has to be exact and fast.
 *
 * No client is made here. The page passes its own core client (the person's
 * session, under RLS) and the capture route passes the service-role one
 * (inngest/core/supabase-admin.ts), since it has no session.
 */

export const CAPTURE_TOKEN_PREFIX = 'dash_';

const TOKEN_PATTERN = /^dash_[A-Za-z0-9_-]{43}$/;

/**
 * How many captures one token may make. Each capture without a place set is
 * one paid model call to sort it, so the limit is what a person talking to
 * their phone could plausibly do, and no more.
 */
export const CAPTURE_TOKEN_RATE = {
  perMinute: 10,
  perDay: 100,
} as const;

/**
 * What a token is for (supabase/migrations/0248_ask_tokens.sql). A capture
 * token only adds things; an ask token asks Dash a question and hears the
 * answer, so it reads. Neither address takes the other kind.
 */
export type DashTokenKind = 'capture' | 'ask';

/**
 * How many questions one ask token may ask. Each is an answer from Dash with
 * its lookups, several model calls, so the limit is lower than capture's.
 */
export const ASK_TOKEN_RATE = {
  perMinute: 5,
  perDay: 60,
} as const;

const RATES: Record<DashTokenKind, { perMinute: number; perDay: number }> = {
  capture: CAPTURE_TOKEN_RATE,
  ask: ASK_TOKEN_RATE,
};

export { CAPTURE_TOKEN_LABEL_MAX, captureTokenLabel } from './token-label';

/** Hex SHA-256 of the whole token, as core.capture_tokens.token_hash holds it. */
export function hashCaptureToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A new token and its hash. The token goes to the person once; the hash is stored. */
export function makeCaptureToken(): { token: string; hash: string } {
  const token = `${CAPTURE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashCaptureToken(token) };
}

/** Whether a string has the shape of a capture token, before anything is looked up. */
export function isCaptureTokenShape(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/**
 * The token from an `Authorization: Bearer <token>` header, or null when the
 * header is missing or carries something else.
 */
export function tokenFromAuthorization(header: string | null | undefined): string | null {
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Checking a presented token
// ---------------------------------------------------------------------------

export type CaptureTokenCheck =
  | { ok: true; userId: string; tokenId: string }
  | {
      ok: false;
      /** 401 for a token that is missing, malformed, unknown or revoked; 429 for the limit. */
      status: 401 | 429;
      reason: 'missing' | 'malformed' | 'unknown' | 'revoked' | 'other_kind' | 'limited';
      /** Whole seconds until the limit lets the token back in; for Retry-After. */
      retryAfterSeconds?: number;
      /** What the caller is told. A Shortcut speaks it back, so it is written for the person. */
      message: string;
    };

type UseRow = {
  outcome: 'ok' | 'unknown' | 'revoked' | 'other_kind' | 'limited';
  user_id: string | null;
  token_id: string | null;
  retry_at: string | null;
};

function wait(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const MAKE_ONE = 'Make a new one on your account page in Dash.';

/** The token's name in what the caller is told. */
const NOUN: Record<DashTokenKind, string> = { capture: 'capture token', ask: 'ask token' };

/** Why the other kind of token was refused, said for the person. */
const OTHER_KIND: Record<DashTokenKind, string> = {
  capture: 'That is an ask token, which asks Dash questions. Adding things takes a capture token; make one on your account page in Dash.',
  ask: 'That is a capture token, which can only add things. Asking Dash takes an ask token; make one on your account page in Dash.',
};

/** What a full limit says, by kind. */
function limitedMessage(kind: DashTokenKind, retryAfterSeconds: number): string {
  const rate = RATES[kind];
  const what =
    kind === 'ask'
      ? `Too many questions: one ask token can ask ${rate.perMinute} a minute and ${rate.perDay} a day.`
      : `Too many captures: one token can add ${rate.perMinute} things a minute and ${rate.perDay} a day.`;
  return `${what} Try again in ${wait(retryAfterSeconds)}.`;
}

/** What one outcome of core.use_dash_token means for the caller. */
export function captureTokenVerdict(row: UseRow | null, now: number, kind: DashTokenKind = 'capture'): CaptureTokenCheck {
  const unknown = `That ${NOUN[kind]} is not one Dash knows. ${MAKE_ONE}`;
  if (!row || row.outcome === 'unknown') {
    return { ok: false, status: 401, reason: 'unknown', message: unknown };
  }
  if (row.outcome === 'revoked') {
    return { ok: false, status: 401, reason: 'revoked', message: `That ${NOUN[kind]} was revoked. ${MAKE_ONE}` };
  }
  if (row.outcome === 'other_kind') {
    return { ok: false, status: 401, reason: 'other_kind', message: OTHER_KIND[kind] };
  }
  if (row.outcome === 'limited') {
    const at = row.retry_at ? Date.parse(row.retry_at) : now + 60_000;
    const retryAfterSeconds = Math.max(1, Math.ceil((at - now) / 1000));
    return { ok: false, status: 429, reason: 'limited', retryAfterSeconds, message: limitedMessage(kind, retryAfterSeconds) };
  }
  if (!row.user_id || !row.token_id) {
    return { ok: false, status: 401, reason: 'unknown', message: unknown };
  }
  return { ok: true, userId: row.user_id, tokenId: row.token_id };
}

/**
 * Check a presented capture token and, when it may add something, count that
 * against its limit. Returns the owning account on success. Takes the
 * service-role core client: core.use_dash_token runs for nobody else.
 *
 * A capture is counted here, before it is filed, so a capture that then fails
 * still uses a slot. That keeps the limit honest about model calls, which are
 * paid for whether or not the filing succeeds.
 */
export async function checkCaptureToken(
  core: SchemaClient,
  token: string | null,
  now: number = Date.now(),
): Promise<CaptureTokenCheck> {
  return checkDashToken(core, token, 'capture', now);
}

/** checkCaptureToken for either kind: a token of the other kind is refused and not counted. */
export async function checkDashToken(
  core: SchemaClient,
  token: string | null,
  kind: DashTokenKind,
  now: number = Date.now(),
): Promise<CaptureTokenCheck> {
  if (!token) {
    return {
      ok: false,
      status: 401,
      reason: 'missing',
      message: `No ${NOUN[kind]} was sent. Make one on your account page in Dash and put it in the Authorization header.`,
    };
  }
  if (!isCaptureTokenShape(token)) {
    return { ok: false, status: 401, reason: 'malformed', message: `That is not a ${NOUN[kind]}. ${MAKE_ONE}` };
  }
  const rate = RATES[kind];
  const { data, error } = await core.rpc('use_dash_token', {
    p_hash: hashCaptureToken(token),
    p_kind: kind,
    p_per_minute: rate.perMinute,
    p_per_day: rate.perDay,
    p_now: new Date(now).toISOString(),
  });
  if (error) throw new Error(`Could not check the ${NOUN[kind]}: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as UseRow | undefined;
  return captureTokenVerdict(row ?? null, now, kind);
}

// ---------------------------------------------------------------------------
// The account page
// ---------------------------------------------------------------------------

/** One token as the account page lists it. The hash is never read. */
export type CaptureTokenListing = {
  id: string;
  label: string;
  /** What the token may do: add things, or ask Dash. */
  kind: DashTokenKind;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** The person's tokens, newest first: live ones, then revoked ones. */
export async function loadCaptureTokens(core: SchemaClient, userId: string): Promise<CaptureTokenListing[]> {
  const { data, error } = await core
    .from('capture_tokens')
    .select('id, label, kind, created_at, last_used_at, revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not read your capture tokens: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    label: string;
    kind: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[];
  const listed = rows.map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind === 'ask' ? ('ask' as const) : ('capture' as const),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
  return [...listed.filter((t) => !t.revokedAt), ...listed.filter((t) => t.revokedAt)];
}

/** Make a token for the signed-in person. Returns the token itself, which is never readable again. */
export async function createCaptureToken(
  core: SchemaClient,
  userId: string,
  label: string,
  kind: DashTokenKind = 'capture',
): Promise<{ id: string; token: string }> {
  const { token, hash } = makeCaptureToken();
  const { data, error } = await core
    .from('capture_tokens')
    .insert({ user_id: userId, label, token_hash: hash, kind })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not make the token: ${error?.message ?? 'nothing came back'}`);
  return { id: (data as { id: string }).id, token };
}

/** Revoke one of the signed-in person's tokens. False when it is not theirs. */
export async function revokeCaptureToken(core: SchemaClient, id: string): Promise<boolean> {
  const { data, error } = await core.rpc('revoke_capture_token', { p_id: id });
  if (error) throw new Error(`Could not revoke the token: ${error.message}`);
  return data !== null;
}
