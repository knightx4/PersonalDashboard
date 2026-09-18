import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { sessionUser, type SessionUser } from '@/lib/auth/session-user';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Uses the anon key, so every query it makes is subject to RLS. That is the
 * point: application code never gets to decide who owns a row.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session on every request, so there is
            // nothing to recover here.
          }
        },
      },
    },
  );
}

/**
 * The authenticated user, or null.
 *
 * Verifies the access token here rather than asking the auth server. That is
 * not the getSession() weakness: getSession() hands back whatever the cookie
 * decodes to without checking the signature, so anyone who can set a cookie can
 * claim to be anyone. getClaims() checks the signature and the expiry before it
 * returns anything, and only the project's private signing key can produce a
 * signature that passes -- the same proof getUser() gets from the auth server,
 * established from the token instead of from a round trip. This project signs
 * with ECC P-256, so the check runs in WebCrypto against public keys cached for
 * ten minutes; on a symmetric secret getClaims() would go back to asking the
 * auth server on its own, correct but no faster.
 *
 * What the round trip did buy is revocation. A token stays verifiable until it
 * expires, so signing out in one browser leaves the other one working for the
 * rest of the token's hour. Sessions are short and the pages behind them are
 * one person's own rows, which is the trade this makes.
 *
 * Never take a user id from a request body or query param either -- it comes
 * from here or it does not exist.
 */
export async function getUser(): Promise<SessionUser | null> {
  return sessionUser(await createClient());
}

/** getUser(), but throws instead of returning null. For routes past middleware. */
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error('unauthenticated');
  return user;
}
