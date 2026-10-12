import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { isOwner } from '@/lib/dev/owner';
import { signOAuthState } from '@/lib/email/oauth-state';
import { X_VERIFIER_COOKIE, xCallbackPath, xPostsReturn } from '@/lib/x/routes';
import { isXOAuthConfigured, xOAuthEnv } from '@/lib/x/env';
import { createCodeVerifier, xAuthorizationUrl } from '@/lib/x/oauth';

/**
 * Connect X (plan #1818): start the OAuth 2.0 round trip that lets the
 * dashboard read the person's own posts.
 *
 * The signed state ties the round trip to this account the way the Gmail
 * grant does (lib/email/oauth-state.ts). The PKCE verifier stays on this
 * browser in an httpOnly cookie scoped to /api/x, and only its hash goes to X.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login?next=/dev/posts', request.url));
  if (!(await isOwner({ user }))) return NextResponse.redirect(new URL('/', request.url));

  if (!isXOAuthConfigured()) return NextResponse.redirect(xPostsReturn(request.url, 'unconfigured'));

  const env = xOAuthEnv();
  const verifier = createCodeVerifier();
  const cookieStore = await cookies();
  cookieStore.set(X_VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/x',
    maxAge: 15 * 60,
  });

  const origin = await requestOrigin();
  const url = xAuthorizationUrl({
    clientId: env.X_CLIENT_ID,
    redirectUri: `${origin.replace(/\/$/, '')}${xCallbackPath}`,
    state: signOAuthState(user.id, env.TOKEN_ENCRYPTION_KEY),
    verifier,
  });
  return NextResponse.redirect(url);
}
