import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { encryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { verifyGmailOAuthState } from '@/lib/email/oauth-state';
import { gmailProvider } from '@/lib/email/providers/gmail';

/**
 * Gmail read-grant callback. Stores encrypted tokens on email_accounts.
 * Sync/backfill arrives in build step 12.
 */
export async function GET(request: NextRequest) {
  const settingsUrl = new URL('/settings', request.url);
  settingsUrl.hash = 'inboxes';

  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/settings', request.url));
  }

  const { searchParams } = request.nextUrl;
  const error = searchParams.get('error');
  if (error) {
    settingsUrl.searchParams.set('inbox', 'denied');
    return NextResponse.redirect(settingsUrl);
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) {
    settingsUrl.searchParams.set('inbox', 'error');
    return NextResponse.redirect(settingsUrl);
  }

  const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
  if (!verifyGmailOAuthState(state, user.id, TOKEN_ENCRYPTION_KEY)) {
    settingsUrl.searchParams.set('inbox', 'error');
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const origin = await requestOrigin();
    const redirectUri = `${origin}/api/auth/gmail/callback`;
    const tokens = await gmailProvider.exchangeCode(code, redirectUri);

    if (!tokens.refreshToken) {
      // Google omits refresh_token when the user already consented without prompt=consent.
      settingsUrl.searchParams.set('inbox', 'no_refresh');
      return NextResponse.redirect(settingsUrl);
    }

    const profile = await gmailProvider.fetchProfile(tokens.accessToken);
    const supabase = await createClient();

    const payload = {
      provider: 'gmail' as const,
      email_address: profile.emailAddress,
      oauth_refresh_token: encryptToken(tokens.refreshToken, TOKEN_ENCRYPTION_KEY),
      oauth_access_token: encryptToken(tokens.accessToken, TOKEN_ENCRYPTION_KEY),
      token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      status: 'active' as const,
      last_synced_at: null,
    };

    const { data: existing } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('user_id', user.id)
      .ilike('email_address', profile.emailAddress)
      .maybeSingle();

    const writeError = existing
      ? (
          await supabase.from('email_accounts').update(payload).eq('id', existing.id)
        ).error
      : (
          await supabase.from('email_accounts').insert({ ...payload, user_id: user.id })
        ).error;

    if (writeError) {
      settingsUrl.searchParams.set('inbox', 'error');
      return NextResponse.redirect(settingsUrl);
    }

    settingsUrl.searchParams.set('inbox', 'connected');
    return NextResponse.redirect(settingsUrl);
  } catch {
    settingsUrl.searchParams.set('inbox', 'error');
    return NextResponse.redirect(settingsUrl);
  }
}
