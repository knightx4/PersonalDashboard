import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';
import { APP_SCHEMA } from '@/lib/jobs/db/schema-name';

/**
 * A sessionless Supabase client, for the one page a stranger can read.
 *
 * Deliberately not `createClient()` from ./server: that one reads cookies to
 * attach whatever session the visitor happens to have, and the case page must
 * behave identically for a signed-in stranger and a signed-out one. This
 * client is always `anon`, which is exactly the role the case page's negative
 * cases are asserted against in tests/rls-jobs.test.ts.
 *
 * Still the anon key, so RLS applies in full. The only thing it can usefully
 * reach is `public_case_page()`, which is the whole authorization decision and
 * lives in the migration where it can be read.
 */
export function createPublicClient() {
  return createSupabaseClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: APP_SCHEMA },
      // No cookie storage and no refresh loop: there is no session to keep.
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
