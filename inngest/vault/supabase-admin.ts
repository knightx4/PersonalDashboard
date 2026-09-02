import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { VAULT_SCHEMA, type VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Service-role client for the vault schema.
 *
 * Bypasses RLS -- every query must filter by user or connection explicitly.
 * Only import from `inngest/`, `scripts/`, or a route handler that genuinely
 * has no session; the lint boundary enforces it and tests/lint-boundaries
 * asserts the boundary still fires.
 *
 * Intentionally does NOT use serverEnv(): that requires DATABASE_URL, which is
 * optional on Vercel where we talk to Supabase over HTTPS only.
 */
export function createVaultServiceSupabase(): VaultSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createVaultServiceSupabase is server-only');
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: VAULT_SCHEMA },
  });
}
