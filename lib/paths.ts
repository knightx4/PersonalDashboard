/**
 * Only same-origin relative paths; used for Gmail OAuth return and ?next=.
 *
 * The fallback is required rather than defaulted. Both halves of the app have
 * a settings page now, so there is no single sensible destination to fall back
 * to -- and a default would silently send someone to the other workspace.
 */
export function safeAppPath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || value.includes('\n') || value.includes('\r')) return fallback;
  return value;
}

/**
 * Where a signed-out visit is sent: the sign-in page, with the whole address
 * it asked for as ?next=, query included. The query matters for the OAuth
 * consent page, whose authorization_id is the request itself; with only the
 * pathname kept, signing in lands on a consent page with nothing to consent to.
 */
export function signInRedirect(requested: URL): URL {
  const url = new URL('/login', requested);
  url.searchParams.set('next', `${requested.pathname}${requested.search}`);
  return url;
}
