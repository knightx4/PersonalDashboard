import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getUser } from '@/lib/jobs/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { isGmailOAuthConfigured, gmailOAuthEnv } from '@/lib/email/gmail-env';
import { signGmailOAuthState } from '@/lib/email/oauth-state';
import { gmailProvider } from '@/lib/jobs/email/providers/gmail';
import { safeAppPath } from '@/lib/paths';

const RETURN_COOKIE = 'gmail_oauth_return';

/**
 * Start the Gmail read grant. Separate from Google sign-in — see docs/SETUP.md.
 *
 * Optional `return_to` (relative path) is stored in an httpOnly cookie so the
 * callback can send the user back to onboarding or Settings.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/jobs/settings', request.url));
  }

  if (!isGmailOAuthConfigured()) {
    const failTo = safeAppPath(request.nextUrl.searchParams.get('return_to'), '/jobs/settings');
    const url = new URL(failTo, request.url);
    url.searchParams.set('inbox', 'unconfigured');
    return NextResponse.redirect(url);
  }

  const returnTo = safeAppPath(request.nextUrl.searchParams.get('return_to'), '/jobs/settings');

  const cookieStore = await cookies();
  cookieStore.set(RETURN_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 15 * 60,
  });

  const origin = await requestOrigin();
  const redirectUri = `${origin.replace(/\/$/, '')}/api/auth/gmail/callback`;
  const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
  const state = signGmailOAuthState(user.id, TOKEN_ENCRYPTION_KEY);
  const url = gmailProvider.authorizationUrl(state, redirectUri);

  console.info('gmail oauth connect', { redirectUri, userId: user.id, returnTo });
  return NextResponse.redirect(url);
}
