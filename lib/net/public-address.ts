import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Which addresses this server will connect to.
 *
 * Two modules now fetch a URL somebody else chose -- a reading the learn side
 * found, and a calendar address you pasted -- and both run on a server with an
 * outbound network position no browser has. `http://169.254.169.254/` is the
 * cloud metadata service and `http://127.0.0.1:54321/` is whatever else is
 * listening, so the ranges below are refused before a connection is made.
 *
 * One copy, because a security check that exists twice is a security check
 * that will be improved once. Each fetcher still owns its own protocol rule,
 * size cap, timeout and redirect loop; this is only the question of where an
 * address points.
 */

/**
 * Address ranges nothing on the open web lives in.
 *
 * Checked against the *resolved* address rather than the hostname, because
 * `internal.example.com` resolving to 10.0.0.5 is the ordinary way this is
 * attacked and a hostname allowlist would never see it.
 */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    // Loopback, unspecified, link-local (fe80::/10), unique local (fc00::/7).
    if (v6 === '::1' || v6 === '::') return true;
    if (/^fe[89ab]/.test(v6)) return true;
    if (/^f[cd]/.test(v6)) return true;
    // IPv4-mapped: ::ffff:169.254.169.254 reaches the same place.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not something we can reason about, so not something we will connect to.
    return true;
  }
  const [a, b] = parts;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, and the metadata service
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/**
 * Is this address safe to connect to?
 *
 * Exported for the tests, which is the only way to assert the ranges without
 * a network.
 */
export function addressIsPublic(address: string): boolean {
  return !isPrivateAddress(address);
}

/**
 * Refuse a URL whose host is, or resolves to, somewhere private.
 *
 * Throws rather than returning, so a caller cannot forget the answer. Run it
 * again on every redirect hop: a public URL that 302s to 169.254.169.254 is
 * the standard way past a check that only looks at what was typed.
 */
export async function assertHostIsPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`refusing a private address: ${host}`);
    return;
  }

  const resolved = await lookup(host, { all: true, verbatim: true });
  if (resolved.length === 0) throw new Error(`no address for ${host}`);

  // Every answer, not the first: a name that resolves to one public and one
  // private address is not a name this connects to at all.
  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      throw new Error(`refusing a private address behind ${host}`);
    }
  }
}
