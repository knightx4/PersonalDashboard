import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/**
 * Service-role Supabase client for background jobs.
 * Bypasses RLS — every query must filter by user_id explicitly.
 * Only import from `inngest/` or `scripts/`.
 */
export function createServiceSupabase(): SupabaseClient {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
