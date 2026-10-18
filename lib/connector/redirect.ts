/**
 * Which apps the consent page will send an authorization code to.
 *
 * Supabase's OAuth server accepts dynamic client registration, which claude.ai
 * needs, and that means any site can register itself as a client with any
 * redirect address. The consent page is therefore the one place that decides
 * who is let in: it approves a request only when the code would go to Claude's
 * connector callback or back to the person's own computer, and refuses every
 * other address before it is shown.
 *
 * claude.com is listed beside claude.ai because Anthropic documents it as the
 * callback's future address.
 *
 * A desktop or command-line agent, such as Hermes, listens for the code on a
 * loopback address at a port it picks each time (RFC 8252, section 7.3), so
 * any port and path on 127.0.0.1, [::1] or localhost is allowed over plain
 * http. A code sent there reaches only a program on the computer whose browser
 * approved it, never another site.
 */
const CONNECTOR_CALLBACKS: readonly { host: string; path: string }[] = [
  { host: 'claude.ai', path: '/api/mcp/auth_callback' },
  { host: 'claude.com', path: '/api/mcp/auth_callback' },
];

function parse(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', 'localhost'];

function isLoopback(url: URL): boolean {
  if (url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  return LOOPBACK_HOSTS.includes(url.hostname);
}

function isCallback(url: URL): boolean {
  if (isLoopback(url)) return true;
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  return CONNECTOR_CALLBACKS.some((c) => url.hostname === c.host && url.pathname === c.path);
}

/**
 * True when a client's registered redirect address is Claude's connector
 * callback or a loopback address. The address Supabase reports is the base, without a query, so one
 * that carries a query or a fragment is refused too.
 */
export function isAllowedConnectorRedirect(redirectUri: string | null | undefined): boolean {
  const url = parse(redirectUri);
  if (!url) return false;
  if (url.search || url.hash) return false;
  return isCallback(url);
}

/**
 * True when the address Supabase returns after a decision, which is the
 * registered one with the code or the error and the state added as a query,
 * still points at Claude's connector callback or a loopback address.
 */
export function isAllowedConnectorReturn(
  redirectUrl: string | null | undefined,
): redirectUrl is string {
  const url = parse(redirectUrl);
  if (!url) return false;
  if (url.hash) return false;
  return isCallback(url);
}
