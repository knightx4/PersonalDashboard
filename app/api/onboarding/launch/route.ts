import { NextResponse, type NextRequest } from 'next/server';
import { ONBOARDED_COOKIE, ONBOARDED_COOKIE_OPTIONS } from '@/lib/onboarded-cookie';

/**
 * Where /onboarding sends an account that has finished it. A server component
 * cannot set a cookie, so the page redirects here, the cookie is set, and the
 * visit carries on to Home. Reached only the first time: after that the proxy
 * skips /onboarding.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/home';
  url.search = '';
  const response = NextResponse.redirect(url);
  response.cookies.set(ONBOARDED_COOKIE, '1', ONBOARDED_COOKIE_OPTIONS);
  return response;
}
