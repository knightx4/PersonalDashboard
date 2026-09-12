import 'server-only';

import { assertHostIsPublic } from '@/lib/net/public-address';

/**
 * Reading the address you pasted.
 *
 * The address is somebody else's URL, so the same rules the learn side's
 * fetcher obeys apply here: https only, the resolved host checked on every
 * redirect hop, a hard ceiling on the bytes read and a timeout on the wait.
 * What differs is what is being asked for -- a calendar file rather than a
 * document -- and that a failure here is recorded on the subscription instead
 * of shown to whoever pressed something.
 *
 * No cookies and no credentials: the secret is in the address itself, which is
 * why the address is stored encrypted and never rendered back.
 */

/** A year of a busy calendar is well under this. Beyond it, something is wrong. */
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/**
 * What a calendar file is served as.
 *
 * Google sends text/calendar; a webcal address behind a plain file server can
 * send text/plain or nothing at all. The first line of the body is the real
 * test, so an unhelpful content type is not on its own a reason to refuse.
 */
const REFUSED_TYPES = ['text/html', 'application/xhtml+xml', 'application/json'];

export type CalendarFetch =
  | { ok: true; text: string }
  | { ok: false; detail: string };

function fail(detail: string): CalendarFetch {
  return { ok: false, detail };
}

/**
 * Fetch one subscription's calendar file.
 *
 * `webcal://` is what a calendar app hands you when you press "subscribe"; it
 * is an https URL wearing a different scheme, and turning it into one here
 * saves everybody the paste-and-edit.
 */
export async function fetchCalendar(address: string): Promise<CalendarFetch> {
  let url: URL;
  try {
    url = new URL(address.trim().replace(/^webcal:/i, 'https:'));
  } catch {
    return fail('not a web address');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'https:') {
      return fail(`refusing ${url.protocol.replace(':', '')}, https only`);
    }

    try {
      await assertHostIsPublic(url);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'host check failed');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Identify honestly. A calendar host that blocks this is entitled to.
          'user-agent': 'PersonalTracker-Calendar/1.0 (+calendar subscription; one user)',
          accept: 'text/calendar, text/plain',
        },
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      if (timedOut) return fail('the calendar took too long to answer');
      return fail(error instanceof Error ? error.message : 'could not reach the calendar');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return fail(`${response.status} with nowhere to go`);
      try {
        url = new URL(location, url);
      } catch {
        return fail('redirected to something that is not a URL');
      }
      continue;
    }

    if (!response.ok) return fail(reasonFor(response.status));

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (REFUSED_TYPES.includes(type)) {
      // A sign-in page answers 200 with HTML. Reading it as a calendar would
      // record "no appointments" rather than "this address needs renewing".
      return fail(`that address answered with ${type}, not a calendar`);
    }

    const text = await readCapped(response);
    if (text === null) return fail('that calendar is too large to read');
    if (!text.includes('BEGIN:VCALENDAR')) return fail('that address is not a calendar file');

    return { ok: true, text };
  }

  return fail('too many redirects');
}

/** What went wrong, in words the settings page can show. */
function reasonFor(status: number): string {
  if (status === 401 || status === 403) return 'that address was refused -- it may have been reset';
  if (status === 404 || status === 410) return 'that address is gone';
  return `the calendar answered ${status}`;
}

/**
 * Read the body with a hard ceiling.
 *
 * `Content-Length` is a claim, not a fact, so the cap is enforced on the bytes
 * that actually arrive.
 */
async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';

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

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8').decode(bytes);
}
