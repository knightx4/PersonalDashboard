/**
 * The paths and cookie the X round trip shares between its two routes and
 * the Posts tab (plan #1818).
 */

/** The PKCE verifier, kept on the browser between /api/x/connect and the callback. */
export const X_VERIFIER_COOKIE = 'x_oauth_verifier';

/** Registered on the X app as https://dash.selveyknight.com/api/x/callback (step #1816). */
export const xCallbackPath = '/api/x/callback';

export const X_CONNECT_PATH = '/api/x/connect';

/** Back to the Posts tab with what happened in `?x=`. */
export function xPostsReturn(base: string, code: string): URL {
  const url = new URL('/dev/posts', base);
  url.searchParams.set('x', code);
  return url;
}
