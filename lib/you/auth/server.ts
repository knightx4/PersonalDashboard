import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { YOU_SCHEMA, type YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * Supabase client for the you schema, on the user's own session.
 *
 * Anon key, so row level security applies and no query in lib/you passes a
 * user id to decide whose rows it sees.
 */
export async function createYouClient(): Promise<YouSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: YOU_SCHEMA },
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
  ) as YouSupabaseClient;
}
