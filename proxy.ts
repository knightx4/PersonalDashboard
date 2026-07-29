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

  if (user && (pathname === '/login' || pathname === '/signup')) {
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
     * Everything except static assets and image files. Auth pages are matched
     * deliberately, so a signed-in user gets bounced off /login.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
