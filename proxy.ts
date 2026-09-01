import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Session refresh and route protection (Next 16 proxy convention; this file
 * was `middleware.ts` before the rename).
 *
 * Protection lives here rather than in page components so there is exactly one
 * place that decides what is public. A page that forgets its own auth check
 * cannot leak, because it is never reached.
 *
 * This also refreshes the Supabase session on every request, which is what
 * keeps cookie sessions alive in Server Components (they cannot write cookies
 * themselves).
 */

/** Everything not listed here requires a session. */
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/reset-password',
  '/update-password',
  '/auth/callback',
  '/auth/auth-code-error',
  // Required by Google before a restricted-scope app can leave testing status,
  // and read by a human reviewer during brand verification.
  '/privacy',
  '/terms',
  // HMAC-authenticated Gmail backfill continuation (no user session).
  '/api/inbox/sync/continue',
  '/api/jobs/inbox/sync/continue',
  // Vercel Cron — authenticated via CRON_SECRET Bearer token.
  '/api/cron',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(): this revalidates the token against the auth
  // server. Do not put any logic between createServerClient and this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // A signed-in person has no use for the marketing page or the sign-in form.
  // `/` was missing from this list, so opening the site while already signed
  // in showed a homepage inviting you to sign in -- on a phone, where the app
  // is opened from a bookmark, that is every visit.
  //
  // Sent to /onboarding rather than straight to the dashboard because that is
  // the page that knows which it should be: it forwards a finished account to
  // /shopping/dashboard and keeps an unfinished one where it belongs.
  if (user && (pathname === '/' || pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The homepage and the
     * auth pages are matched deliberately, so a signed-in user gets bounced
     * off all three.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
