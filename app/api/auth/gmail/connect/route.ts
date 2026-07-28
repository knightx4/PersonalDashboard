import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { signGmailOAuthState } from '@/lib/email/oauth-state';
import { gmailProvider } from '@/lib/email/providers/gmail';

/**
 * Start the Gmail read grant (build step 10). Separate from Google sign-in —
 * see docs/SETUP.md Tier 2.
 */
export async function GET(_request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/settings', _request.url));
  }

  if (!isGmailOAuthConfigured()) {
    return NextResponse.redirect(new URL('/settings?inbox=unconfigured', _request.url));
  }

  const origin = await requestOrigin();
  const redirectUri = `${origin}/api/auth/gmail/callback`;
  const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
  const state = signGmailOAuthState(user.id, TOKEN_ENCRYPTION_KEY);
  const url = gmailProvider.authorizationUrl(state, redirectUri);

  return NextResponse.redirect(url);
}
