import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Supabase client for the ingestion schema, on the user's own session.
 *
 * Anon key, so RLS applies -- the connected mailbox, its sync runs and its
 * messages are all reachable only by the account that owns them. Both
 * workspaces' settings pages read through this, because there is one inbox now
 * and it belongs to neither of them.
 */
export async function createCoreClient(): Promise<CoreSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: CORE_SCHEMA },
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
  ) as CoreSupabaseClient;
}
