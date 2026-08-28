import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Service-role client for the ingestion schema.
 *
 * Bypasses RLS -- every query must filter by account or user explicitly. Only
 * import from `inngest/`, `scripts/`, or a route handler that genuinely has no
 * session.
 *
 * Intentionally does NOT use serverEnv(): that requires DATABASE_URL, which is
 * optional on Vercel where we talk to Supabase over HTTPS only.
 */
export function createCoreServiceSupabase(): CoreSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createCoreServiceSupabase is server-only');
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: CORE_SCHEMA },
  });
}
