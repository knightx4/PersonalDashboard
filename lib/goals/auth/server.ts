import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import {
  GOALS_SCHEMA,
  historyHeaders,
  type GoalsActor,
  type GoalsSupabaseClient,
} from '@/lib/goals/db/schema-name';

/**
 * Supabase client for the goals schema, on the user's own session.
 *
 * Anon key, so row level security applies and no query in lib/goals passes a
 * user id to decide whose rows it sees. Every write through it is recorded in
 * goals.history by the database; `history` only changes what the record says
 * about who made it (see historyHeaders).
 */
export async function createGoalsClient(
  history: { actor?: GoalsActor; captureId?: string } = {},
): Promise<GoalsSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: GOALS_SCHEMA },
      global: { headers: historyHeaders(history) },
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
  ) as GoalsSupabaseClient;
}
