import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { encryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { gmailRedirectUri } from '@/lib/email/gmail-redirect';
import { verifyGmailOAuthState } from '@/lib/email/oauth-state';
import { gmailProvider, hasGmailReadonlyScope } from '@/lib/email/providers/gmail';
import { safeAppPath } from '@/lib/paths';

const RETURN_COOKIE = 'gmail_oauth_return';

async function finishRedirect(request: NextRequest, code: string) {
  const cookieStore = await cookies();
  const returnTo = safeAppPath(cookieStore.get(RETURN_COOKIE)?.value, '/shopping/settings');
  cookieStore.delete(RETURN_COOKIE);

  const url = new URL(returnTo, request.url);
  url.searchParams.set('inbox', code);
  return NextResponse.redirect(url);
}

/**
 * Gmail read-grant callback. Stores encrypted tokens on email_accounts.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/shopping/settings', request.url));
  }

  const { searchParams } = request.nextUrl;
  const oauthError = searchParams.get('error');
  if (oauthError) {
    console.error('gmail oauth denied', oauthError, searchParams.get('error_description'));
    return finishRedirect(request, 'denied');
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) {
    return finishRedirect(request, 'missing_code');
  }

  let encryptionKey: string;
  try {
    encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  } catch (err) {
    console.error('gmail oauth env', err);
    return finishRedirect(request, 'unconfigured');
  }

  if (!verifyGmailOAuthState(state, user.id, encryptionKey)) {
    console.error('gmail oauth state mismatch', { userId: user.id });
    return finishRedirect(request, 'state');
  }

  try {
    const liveRedirect = `${request.nextUrl.origin}/api/auth/gmail/callback`;
    const configuredRedirect = await gmailRedirectUri();

    console.info('gmail oauth exchange', {
      liveRedirect,
      configuredRedirect,
      match: liveRedirect === configuredRedirect,
    });

    const tokens = await gmailProvider.exchangeCode(code, liveRedirect);

    if (!tokens.refreshToken) {
      console.error('gmail oauth missing refresh_token');
      return finishRedirect(request, 'no_refresh');
    }

    if (tokens.scope && !hasGmailReadonlyScope(tokens.scope)) {
      console.error('gmail oauth missing readonly scope', { scope: tokens.scope });
      return finishRedirect(request, 'scope_denied');
    }

    let emailAddress: string;
    try {
      const profile = await gmailProvider.fetchProfile(tokens.accessToken);
      emailAddress = profile.emailAddress.toLowerCase();
    } catch (profileErr) {
      console.error('gmail oauth profile/scope check failed', profileErr);
      return finishRedirect(request, 'scope_denied');
    }

    const supabase = await createCoreClient();
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
      // The mailbox lives in `core`, which has to be listed under Settings →
      // API → Exposed schemas. When it is not, the grant succeeds at Google and
      // then vanishes here -- which looks like "connecting Gmail does nothing".
      if (lookupError.code === 'PGRST106') return finishRedirect(request, 'schema');
      return finishRedirect(request, 'db_lookup');
    }

    const write = existing
      ? await supabase.from('email_accounts').update(payload).eq('id', existing.id)
      : await supabase.from('email_accounts').insert({ ...payload, user_id: user.id });

    if (write.error) {
      console.error('gmail account write', write.error);
      if (write.error.code === 'PGRST106') return finishRedirect(request, 'schema');
      return finishRedirect(request, 'db_write');
    }

    return finishRedirect(request, 'connected');
  } catch (err) {
    console.error('gmail oauth callback', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Gmail profile')) {
      return finishRedirect(request, 'profile');
    }
    if (
      message.includes('invalid_grant') ||
      message.includes('redirect_uri') ||
      message.includes('unauthorized_client')
    ) {
      return finishRedirect(request, 'exchange');
    }
    if (message.includes('TOKEN_ENCRYPTION_KEY')) {
      return finishRedirect(request, 'encrypt');
    }
    return finishRedirect(request, 'error');
  }
}
