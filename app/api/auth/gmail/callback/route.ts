import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { encryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { gmailRedirectUri } from '@/lib/email/gmail-redirect';
import { verifyGmailOAuthState } from '@/lib/email/oauth-state';
import { gmailProvider, hasGmailReadonlyScope } from '@/lib/email/providers/gmail';

function settingsRedirect(request: NextRequest, code: string) {
  const url = new URL('/settings', request.url);
  url.searchParams.set('inbox', code);
  return NextResponse.redirect(url);
}

/**
 * Gmail read-grant callback. Stores encrypted tokens on email_accounts.
 * Sync/backfill arrives in build step 12.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/settings', request.url));
  }

  const { searchParams } = request.nextUrl;
  const oauthError = searchParams.get('error');
  if (oauthError) {
    console.error('gmail oauth denied', oauthError, searchParams.get('error_description'));
    return settingsRedirect(request, 'denied');
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) {
    return settingsRedirect(request, 'missing_code');
  }

  let encryptionKey: string;
  try {
    encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  } catch (err) {
    console.error('gmail oauth env', err);
    return settingsRedirect(request, 'unconfigured');
  }

  if (!verifyGmailOAuthState(state, user.id, encryptionKey)) {
    console.error('gmail oauth state mismatch', { userId: user.id });
    return settingsRedirect(request, 'state');
  }

  try {
    // Must match the redirect_uri from the authorize step AND the URL Google hit.
    // Prefer the live callback origin; fall back to the configured app URL.
    const liveRedirect = `${request.nextUrl.origin}/api/auth/gmail/callback`;
    const configuredRedirect = await gmailRedirectUri();
    const redirectUri = liveRedirect;

    console.info('gmail oauth exchange', {
      liveRedirect,
      configuredRedirect,
      match: liveRedirect === configuredRedirect,
    });

    const tokens = await gmailProvider.exchangeCode(code, redirectUri);

    if (!tokens.refreshToken) {
      console.error('gmail oauth missing refresh_token');
      return settingsRedirect(request, 'no_refresh');
    }

    // Google granular consent can return openid/email without gmail.readonly.
    // Do not trust the ID token alone — Connect must prove Gmail API access.
    if (tokens.scope && !hasGmailReadonlyScope(tokens.scope)) {
      console.error('gmail oauth missing readonly scope', { scope: tokens.scope });
      return settingsRedirect(request, 'scope_denied');
    }

    let emailAddress: string;
    try {
      const profile = await gmailProvider.fetchProfile(tokens.accessToken);
      emailAddress = profile.emailAddress.toLowerCase();
    } catch (profileErr) {
      console.error('gmail oauth profile/scope check failed', profileErr);
      return settingsRedirect(request, 'scope_denied');
    }

    const supabase = await createClient();
    const payload = {
      provider: 'gmail' as const,
      email_address: emailAddress,
      oauth_refresh_token: encryptToken(tokens.refreshToken, encryptionKey),
      oauth_access_token: encryptToken(tokens.accessToken, encryptionKey),
      token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      status: 'active' as const,
      last_synced_at: null,
    };

    const { data: existing, error: lookupError } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('email_address', emailAddress)
      .maybeSingle();

    if (lookupError) {
      console.error('gmail account lookup', lookupError);
      return settingsRedirect(request, 'db_lookup');
    }

    const write = existing
      ? await supabase.from('email_accounts').update(payload).eq('id', existing.id)
      : await supabase.from('email_accounts').insert({ ...payload, user_id: user.id });

    if (write.error) {
      console.error('gmail account write', write.error);
      return settingsRedirect(request, 'db_write');
    }

    return settingsRedirect(request, 'connected');
  } catch (err) {
    console.error('gmail oauth callback', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Gmail profile')) {
      return settingsRedirect(request, 'profile');
    }
    if (
      message.includes('invalid_grant') ||
      message.includes('redirect_uri') ||
      message.includes('unauthorized_client')
    ) {
      return settingsRedirect(request, 'exchange');
    }
    if (message.includes('TOKEN_ENCRYPTION_KEY')) {
      return settingsRedirect(request, 'encrypt');
    }
    return settingsRedirect(request, 'error');
  }
}
