import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Uses the anon key, so every query it makes is subject to RLS. That is the
 * point: application code never gets to decide who owns a row.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
 * Always calls getUser(), never getSession(): getSession reads the cookie
 * without verifying it against the auth server, so it can be spoofed. Never
 * take a user id from a request body or query param either -- it comes from
 * here or it does not exist.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** getUser(), but throws instead of returning null. For routes past middleware. */
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error('unauthenticated');
  return user;
}
