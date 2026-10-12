import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { verifyOAuthState } from '@/lib/email/oauth-state';
import { xAccountWrite } from '@/lib/x/account';
import { isXOAuthConfigured, xClient, xOAuthEnv } from '@/lib/x/env';
import { exchangeXCode, fetchXMe, XOAuthError } from '@/lib/x/oauth';
import { X_VERIFIER_COOKIE, xCallbackPath, xPostsReturn } from '@/lib/x/routes';

/**
 * X's OAuth callback (plan #1818): trade the code for tokens, ask X who they
 * read as, and keep both on the person's x_accounts row, tokens encrypted.
 * Every outcome lands back on the Posts tab with `?x=<what happened>`, which
 * the tab turns into one line (xConnectNotice).
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login?next=/dev/posts', request.url));
  const supabase = await createClient();
  if (!(await isOwner({ user, supabase }))) return NextResponse.redirect(new URL('/', request.url));

  const cookieStore = await cookies();
  const verifier = cookieStore.get(X_VERIFIER_COOKIE)?.value ?? null;
  cookieStore.delete({ name: X_VERIFIER_COOKIE, path: '/api/x' });
  const back = (code: string) => NextResponse.redirect(xPostsReturn(request.url, code));

  const { searchParams } = request.nextUrl;
  if (searchParams.get('error')) {
    console.error('x oauth denied', searchParams.get('error'), searchParams.get('error_description'));
    return back('denied');
  }
  if (!isXOAuthConfigured()) return back('unconfigured');

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const env = xOAuthEnv();
  if (!code || !state || !verifier || !verifyOAuthState(state, user.id, env.TOKEN_ENCRYPTION_KEY)) {
    console.error('x oauth state', { hasCode: Boolean(code), hasVerifier: Boolean(verifier) });
    return back('state');
  }

  try {
    const client = xClient(env);
    // The redirect has to be the one the authorize request named, which is
    // this route on this host.
    const redirectUri = `${request.nextUrl.origin}${xCallbackPath}`;
    const tokens = await exchangeXCode(client, { code, redirectUri, verifier });
    const me = await fetchXMe(tokens.accessToken);

    // Signing in as a different X account starts its reading from scratch;
    // the same account keeps how far it has been read.
    const { data: existing } = await supabase
      .from('x_accounts')
      .select('x_user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const switched = Boolean(existing && existing.x_user_id !== me.id);

    const { error } = await supabase.from('x_accounts').upsert(
      {
        user_id: user.id,
        ...(switched ? { last_synced_at: null, newest_post_id: null } : {}),
        ...xAccountWrite({
          xUserId: me.id,
          handle: me.username,
          tokens,
          encryptionKey: env.TOKEN_ENCRYPTION_KEY,
        }),
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      console.error('x account write', error);
      return back('error');
    }
    return back('connected');
  } catch (err) {
    console.error('x oauth callback', err);
    return back(err instanceof XOAuthError ? 'exchange' : 'error');
  }
}
