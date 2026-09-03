import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { TODO_SCHEMA, type TodoSupabaseClient } from '@/lib/todo/db/schema-name';

/**
 * Supabase client for the todo schema, on the user's own session.
 *
 * Anon key, so RLS applies. Everything the module reads and writes about your
 * own tasks goes through this -- which is what makes "your list is yours" a
 * property of the database rather than of the code being careful.
 */
export async function createTodoClient(): Promise<TodoSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: TODO_SCHEMA },
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
  ) as TodoSupabaseClient;
}
