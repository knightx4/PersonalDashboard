import { lookup } from 'node:dns/promises';

/**
 * Fetching a URL the user pasted is a server-side request forgery primitive
 * unless it is constrained. These are the constraints: https only, public DNS
 * only, no redirects to anywhere private, and a hard timeout.
 */

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return PRIVATE_V4.some((pattern) => pattern.test(address));
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  // IPv4-mapped IPv6.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1], 4);
  return false;
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('That is not a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https URLs can be fetched.');
  }

  const results = await lookup(url.hostname, { all: true }).catch(() => []);
  if (results.length === 0) {
    throw new Error('That host could not be resolved.');
  }
  for (const entry of results) {
    if (isPrivateAddress(entry.address, entry.family)) {
      throw new Error('That URL resolves to a private address.');
    }
  }

  return url;
}

export const FETCH_TIMEOUT_MS = 12_000;
export const MAX_BODY_BYTES = 2_000_000;

/** Fetch with the constraints above, following no redirects blindly. */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  depth = 0,
): Promise<{ url: string; status: number; body: string; contentType: string }> {
  if (depth > 3) throw new Error('Too many redirects.');

  const url = await assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        // Identify honestly. A career page that blocks this is one we fall back
        // to the paste box for, which is the documented behaviour anyway.
        'User-Agent': 'ApplicationManager/1.0 (+job description fetch; one request per paste)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...(init.headers ?? {}),
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without a destination.');
      return safeFetch(new URL(location, url).toString(), init, depth + 1);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      throw new Error('That page is too large to read.');
    }

    return {
      url: url.toString(),
      status: response.status,
      body: new TextDecoder().decode(buffer),
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}
