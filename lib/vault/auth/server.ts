import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import { VAULT_SCHEMA, type VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Supabase client for the vault schema, on the user's own session.
 *
 * Anon key, so RLS applies. Everything the viewer reads goes through this --
 * there is no path in the rendering layer that reaches the notes any other
 * way, which is what makes "your vault is yours" a property of the database
 * rather than of the code being careful.
 */
export async function createVaultClient(): Promise<VaultSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: VAULT_SCHEMA },
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
  ) as VaultSupabaseClient;
}
