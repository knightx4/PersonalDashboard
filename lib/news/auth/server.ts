import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';

/**
 * Supabase client for the news schema, on the user's own session.
 *
 * Anon key, so RLS applies. Everything a page or an action in this module reads
 * and writes goes through this, which is what makes "your newsletters are
 * yours" a property of the database rather than of the code being careful. No
 * file in lib/news/ passes a user id to a query; the policy decides.
 *
 * Delivery is the one path that does not come through here. A message posted by
 * the mail service arrives with no session, so it is written by the service role
 * and the address it was sent to is what says whose it is.
 */
export async function createNewsClient(): Promise<NewsSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: NEWS_SCHEMA },
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
            // The proxy refreshes the session on every request.
          }
        },
      },
    },
  ) as NewsSupabaseClient;
}
