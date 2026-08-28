'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Supabase client for Client Components.
 *
 * The anon key is the only key that may ever reach the browser.
 */
export function createClient() {
  return createBrowserClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
