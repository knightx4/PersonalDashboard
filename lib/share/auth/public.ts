import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

/**
 * A sessionless Supabase client, for the pages a stranger can open.
 *
 * The shopping-schema twin of lib/jobs/auth/public.ts, and deliberately not
 * `createClient()` from lib/auth/server: that one reads cookies and attaches
 * whatever session the visitor happens to have, so a signed-in stranger would
 * get a different page from a signed-out one -- and on my own phone, already
 * logged in, the page I was testing would not be the page she sees.
 *
 * Still the anon key, so RLS applies in full. The only things it can usefully
 * reach are share_page() and share_respond(), which are the whole
 * authorization decision and live in supabase/migrations/0041_share_rpcs.sql
 * where they can be read.
 */
export function createSharePublicClient() {
  return createSupabaseClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // No cookie storage and no refresh loop: there is no session to keep.
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
