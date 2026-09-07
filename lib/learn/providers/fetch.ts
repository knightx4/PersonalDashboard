import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching somebody else's URL, safely.
 *
 * Every other integration in this app talks to a host we chose: GitHub, Gmail,
 * eBay, BoardGameGeek. This one fetches addresses that came out of a model
 * that read text a stranger wrote, which is a server-side request forgery
 * surface and is new to the codebase.
 *
 * The threat is not exotic. This code runs on Vercel with an outbound network
 * position no browser has. `http://169.254.169.254/` is the cloud metadata
 * service; `http://127.0.0.1:54321/` is whatever else is listening. A resolver
 * that answers with a private address, or a redirect on the third hop, gets
 * you there just as well as a literal one -- so the check runs on every hop,
 * against the resolved address, not against the hostname.
 *
 * Nothing outside lib/learn/providers/ fetches an external URL. The rule is
 * the same containment lib/vault/providers/ and lib/email/providers/ obey, it
 * is enforced by eslint, and tests/lint-boundaries.test.ts proves the rule
 * fires.
 */

/** Beyond this a document is not a document. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/**
 * What a source can be. Anything else is dropped unread -- an image is not a
 * reading, and a zip is not something this ever wants to have downloaded.
 */
const ALLOWED_TYPES = ['text/html', 'application/xhtml+xml', 'application/pdf', 'text/plain'];

export type FetchedDocument = {
  /** Where it actually came from, after redirects. Not what was asked for. */
  url: string;
  contentType: 'html' | 'pdf' | 'text';
  /** Decoded for html and text; empty for pdf, whose bytes are in `bytes`. */
  text: string;
  bytes: Uint8Array | null;
  byteLength: number;
};

export type FetchFailure = {
  ok: false;
  /** Distinguished so the caller can say "paywalled" rather than "broken". */
  reason: 'blocked' | 'not-found' | 'unsupported-type' | 'too-large' | 'timeout' | 'error';
  detail: string;
};

export type FetchResult = ({ ok: true } & FetchedDocument) | FetchFailure;

function fail(reason: FetchFailure['reason'], detail: string): FetchFailure {
  return { ok: false, reason, detail };
}

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

async function assertHostIsPublic(url: URL): Promise<void> {
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

function classify(contentType: string): FetchedDocument['contentType'] | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'text/plain') return 'text';
  return null;
}

/**
 * Read the body with a hard ceiling.
 *
 * `Content-Length` is a claim, not a fact, so the cap is enforced on the bytes
 * that actually arrive.
 */
async function readCapped(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetch a document a source points at.
 *
 * Redirects are followed by hand rather than by `fetch`, because the check has
 * to run again on each hop: a public URL that 302s to 169.254.169.254 is the
 * standard way past a check that only looks at what was typed.
 */
export async function fetchDocument(rawUrl: string): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail('blocked', 'not a URL');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'https:') {
      return fail('blocked', `refusing ${url.protocol.replace(':', '')}, https only`);
    }

    try {
      await assertHostIsPublic(url);
    } catch (error) {
      return fail('blocked', error instanceof Error ? error.message : 'host check failed');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Identify honestly. A source that blocks this is entitled to.
          'user-agent': 'PersonalTracker-Learn/1.0 (+reading queue; one user)',
          accept: ALLOWED_TYPES.join(', '),
        },
        // No cookies, no credentials, ever. This is a public read.
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fetch failed';
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return fail(timedOut ? 'timeout' : 'error', message);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return fail('error', `${response.status} with no location`);
      try {
        url = new URL(location, url);
      } catch {
        return fail('blocked', 'redirect to something that is not a URL');
      }
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      return fail('not-found', `${response.status}`);
    }
    if (!response.ok) {
      // 401, 402 and 403 are the interesting ones: a paywall answers this way,
      // and the caller wants to record that rather than call the link broken.
      return fail('error', `${response.status}`);
    }

    const contentType = classify(response.headers.get('content-type') ?? '');
    if (!contentType) {
      return fail('unsupported-type', response.headers.get('content-type') ?? 'no content type');
    }

    const bytes = await readCapped(response);
    if (bytes === null) return fail('too-large', `over ${MAX_BYTES} bytes`);

    return {
      ok: true,
      url: url.toString(),
      contentType,
      text: contentType === 'pdf' ? '' : new TextDecoder('utf-8').decode(bytes),
      bytes: contentType === 'pdf' ? bytes : null,
      byteLength: bytes.byteLength,
    };
  }

  return fail('blocked', 'too many redirects');
}
