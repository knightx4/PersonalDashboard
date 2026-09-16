import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { sessionUser } from '@/lib/auth/session-user';

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
  /* The surface gallery, and only for the screenshot harness -- which cannot
   * sign in, and which is the one caller that needs it unauthenticated. In a
   * deployment UI_PREVIEW is unset, so /preview is not public and the page's
   * own check requires a session. Both halves have to agree or the gallery is
   * either unreachable or open. See app/preview/page.tsx. */
  ...(process.env.UI_PREVIEW === '1' ? ['/preview'] : []),
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
  // eBay marketplace account deletion. eBay carries no session; the GET proves
  // ownership with a hash of EBAY_VERIFICATION_TOKEN, and the POST only ever
  // acknowledges. Required for the production keyset to stay enabled.
  '/api/ebay/account-deletion',
  // The shared case page. Authorized by an unguessable, expiring slug and read
  // through one security definer function that checks both; see
  // supabase/migrations-job-search/0017_public_case_page.sql.
  '/jobs/p',
  // The shared disposition form. Authorized by an unguessable token and read
  // and written through two security definer functions that check it; see
  // supabase/migrations/0042_share_rpcs.sql. Its writes are a server action,
  // which POSTs back to this same path, so nothing else needs opening.
  '/s',
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

  // getClaims(), not getSession(): this verifies the token's signature rather
  // than trusting whatever the cookie decodes to, and does it here instead of
  // at the auth server -- see the comment on getUser() in lib/auth/server.ts.
  // It still refreshes an expiring session first, which is the other half of
  // what this file is for, so do not put any logic between createServerClient
  // and this call.
  const user = await sessionUser(supabase);

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
