import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who the request is from, read from the access token itself.
 *
 * The id and the email are everything the app takes off a session, so this is
 * what the getUser() helpers hand back rather than the full Supabase user --
 * the access token carries these two claims and would have to be traded for a
 * request to the auth server to learn anything more.
 */
export type SessionUser = { id: string; email?: string };

/** Anything with a Supabase `auth` on it: the shared client and the per-schema ones. */
type ClaimsClient = { auth: Pick<SupabaseClient['auth'], 'getClaims'> };

/**
 * Verify the access token and return who it belongs to, or null.
 *
 * getClaims() checks the signature with WebCrypto against the project's public
 * signing keys, which are fetched once per process and held for ten minutes,
 * so a verified session costs no network call at all on almost every request.
 * See the comment on getUser() in lib/auth/server.ts for why that is as safe
 * as asking the auth server, and where it differs.
 *
 * A missing, malformed or expired token is null rather than an error, which is
 * what the call sites already expect from a signed-out visitor.
 */
export async function sessionUser(supabase: ClaimsClient): Promise<SessionUser | null> {
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return null;
  return { id: data.claims.sub, email: data.claims.email };
}
