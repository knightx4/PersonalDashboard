import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';

/**
 * Service-role Supabase client for background jobs.
 * Bypasses RLS — every query must filter by user_id explicitly.
 * Only import from `inngest/` or `scripts/`.
 *
 * Intentionally does NOT use serverEnv() — that requires DATABASE_URL,
 * which is optional on Vercel when we talk to Supabase over HTTPS only.
 */
export function createServiceSupabase(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceSupabase is server-only');
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
