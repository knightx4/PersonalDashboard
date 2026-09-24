import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { GOALS_SCHEMA, historyHeaders, type GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * Service-role client for the goals schema, for the morning run (plan #933).
 *
 * Bypasses RLS -- every query must filter by user_id explicitly. Only import
 * from `inngest/`, `scripts/`, or a route handler that genuinely has no
 * session. Its writes are recorded in goals.history as Claude's, which is who
 * the scheduled run acts for.
 *
 * Intentionally does NOT use serverEnv(): that requires DATABASE_URL, which is
 * optional on Vercel where we talk to Supabase over HTTPS only.
 */
export function createGoalsServiceSupabase(): GoalsSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createGoalsServiceSupabase is server-only');
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: GOALS_SCHEMA },
    global: { headers: historyHeaders({ actor: 'claude' }) },
  }) as GoalsSupabaseClient;
}
