import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { publicEnv } from '@/lib/env';

/**
 * A short sign-in as the person an ask token belongs to, for the ask
 * address (app/api/ask/voice/route.ts).
 *
 * Dash's lookups are written for the person's own session: every read
 * filters by user and row level security checks it again. The ask address
 * has no session, only a token whose owner core.use_dash_token has just
 * named, so rather than run the lookups on the service role it signs in as
 * that owner. The service role makes a one-time sign-in link for them, which
 * is spent at once on the anon key and never sent anywhere; what comes back
 * is a session like the browser's, and the lookups run on its access token
 * through the connector's clients (tokenAskDb).
 *
 * The session is ended once the answer is written, so a question leaves no
 * sign-in behind.
 */

export type VoiceSession = {
  accessToken: string;
  /** Ends the session. Never throws. */
  close: () => Promise<void>;
};

export async function openVoiceSession(userId: string): Promise<VoiceSession> {
  const admin = createCoreServiceSupabase();
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (findError || !email) throw new Error(`Could not find the token's owner: ${findError?.message ?? 'no email'}`);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) throw new Error(`Could not sign in as the token's owner: ${linkError?.message ?? 'no link'}`);

  const anon = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: signedIn, error: verifyError } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  const session = signedIn?.session;
  if (verifyError || !session) throw new Error(`Could not sign in as the token's owner: ${verifyError?.message ?? 'no session'}`);
  if (session.user.id !== userId) throw new Error('The sign-in came back for a different account.');

  return {
    accessToken: session.access_token,
    close: async () => {
      try {
        await admin.auth.admin.signOut(session.access_token, 'local');
      } catch (error) {
        console.error('the ask address session was not ended', error);
      }
    },
  };
}
