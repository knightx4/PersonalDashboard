import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { isGmailOAuthConfigured, gmailOAuthEnv } from '@/lib/email/gmail-env';
import { signGmailOAuthState } from '@/lib/email/oauth-state';
import { gmailProvider } from '@/lib/email/providers/gmail';

/**
 * Start the Gmail read grant (build step 10). Separate from Google sign-in —
 * see docs/SETUP.md Tier 2.
 *
 * redirect_uri is the live request origin so it matches the callback URL Google
 * hits (and the Authorized redirect URI on the Gmail OAuth client).
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/settings', request.url));
  }

  if (!isGmailOAuthConfigured()) {
    return NextResponse.redirect(new URL('/settings?inbox=unconfigured', request.url));
  }

  const origin = await requestOrigin();
  const redirectUri = `${origin.replace(/\/$/, '')}/api/auth/gmail/callback`;
  const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
  const state = signGmailOAuthState(user.id, TOKEN_ENCRYPTION_KEY);
  const url = gmailProvider.authorizationUrl(state, redirectUri);

  console.info('gmail oauth connect', { redirectUri, userId: user.id });
  return NextResponse.redirect(url);
}
