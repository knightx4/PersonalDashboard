import 'server-only';

import { addressIsPublic, assertHostIsPublic } from '@/lib/net/public-address';

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
 * Nothing outside lib/learn/providers/ reaches the web on this module's
 * behalf. The rule is the same containment lib/vault/providers/ and
 * lib/email/providers/ obey, it is enforced by eslint, and
 * tests/lint-boundaries.test.ts proves the rule fires. Which addresses are
 * refused is lib/net/public-address.ts, shared with the calendar
 * subscriptions.
 */

/** Beyond this a document is not a document. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/**
 * What a source can be. Anything else is dropped unread -- an image is not a
 * reading, and a zip is not something this ever wants to have downloaded.
 *
 * `application/json` is here for the catalogue sweeps rather than for a
 * reading: Wikipedia's API answers in JSON and there is no second way out of
 * this module to fetch it with. It widens what a body may be and nothing else
 * -- the address check, the redirect check, the size cap and the timeout all
 * run first and are untouched.
 */
const ALLOWED_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'text/plain',
  'application/json',
];

export type FetchedDocument = {
  /** Where it actually came from, after redirects. Not what was asked for. */
  url: string;
  contentType: 'html' | 'pdf' | 'text' | 'json';
  /** Decoded for html, text and json; empty for pdf, whose bytes are in `bytes`. */
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
 * Re-exported so the tests next door keep asking this module the question they
 * have always asked it. The ranges themselves live in lib/net, because the
 * calendar subscriptions fetch somebody else's URL too and one copy of a
 * security check is the only number that stays right.
 */
export { addressIsPublic };

function classify(contentType: string): FetchedDocument['contentType'] | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'text/plain') return 'text';
  if (type === 'application/json') return 'json';
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
