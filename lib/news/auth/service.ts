import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';

/**
 * SERVICE-ROLE CLIENT FOR THE NEWS SCHEMA. READ THIS BEFORE USING IT.
 *
 * Bypasses RLS, so every query made through it must say whose rows it is
 * touching. Import it only from the inbound route, which genuinely has no
 * session: a message posted by the mail service arrives with nobody signed in,
 * and the address it was sent to is the only thing that says whose it is. The
 * one other caller is scripts/news-digest.ts, which summarises stored issues
 * across accounts and passes each issue's own user id down.
 * Everything a page or an action does goes through lib/news/auth/server.ts and
 * the policies instead.
 *
 * Deliberately not serverEnv(): that requires DATABASE_URL, which is optional
 * on Vercel where the app talks to Supabase over HTTPS only. Same reasoning as
 * inngest/vault/supabase-admin.ts.
 */
export function createNewsServiceClient(): NewsSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createNewsServiceClient is server-only');
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: NEWS_SCHEMA },
  });
}
