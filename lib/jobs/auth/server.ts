import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { APP_SCHEMA } from '@/lib/jobs/db/schema-name';
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
  // Every table this app owns lives in the `job_search` schema, not `public`,
  // so one Supabase project can host several apps at no extra cost. The schema
  // must also be listed under Settings → API → Exposed schemas, or PostgREST
  // will not serve it.
      db: { schema: APP_SCHEMA },
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
 * getClaims() rather than getUser(), so the token is verified here instead of
 * at the auth server; see the comment on the same function in lib/auth/server.ts
 * for why that is safe and what it gives up.
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
