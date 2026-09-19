import 'server-only';

import { z } from 'zod';
import { newsAddress, newsDomainOrNull } from '@/lib/news/address';

/**
 * Sending the unsubscribe mail a publisher asked for.
 *
 * Some publishers put an address in List-Unsubscribe rather than a link, and
 * #615 settled that the app writes to it instead of handing you a mailto: to
 * open. Mailgun has only ever received for this deployment, so this is the
 * first thing here that sends.
 *
 * The mail goes from the address that subscribed, because that is the only
 * address the publisher can match against its list. Which address an issue
 * arrived on is not stored, so an account that has swapped its local part
 * sends from the current one and a publisher that kept the old one will not
 * find it.
 *
 * Nothing here touches the database. #667 owns the issue row and calls this.
 */

/**
 * Mailgun's US API host.
 *
 * A domain created in Mailgun's EU region answers 401 here and has to be
 * posted to api.eu.mailgun.net instead. Nothing in the app knows which region
 * this deployment's domain sits in, so the refusal is reported with its status
 * and body rather than guessed at.
 */
const MAILGUN_API_BASE = 'https://api.mailgun.net/v3';

/** The messages endpoint for one sending domain. */
export function mailgunMessagesUrl(domain: string): string {
  return `${MAILGUN_API_BASE}/${encodeURIComponent(domain)}/messages`;
}

/**
 * The Mailgun API key if this deployment has one, null if it does not.
 *
 * Not the webhook signing key: that one proves an inbound post came from
 * Mailgun and cannot authorise a send. They are separate values in separate
 * parts of the Mailgun dashboard, and using one for the other answers 401.
 *
 * Read at the point of use rather than at module scope, for the reason
 * lib/env.ts gives.
 */
export function mailgunApiKeyOrNull(): string | null {
  const parsed = z.object({ MAILGUN_API_KEY: z.string().min(1) }).safeParse(process.env);
  return parsed.success ? parsed.data.MAILGUN_API_KEY : null;
}

/** The subject when the publisher asked for none. */
export const DEFAULT_UNSUBSCRIBE_SUBJECT = 'unsubscribe';

/**
 * Percent-decoded, or the text as it stands when the escapes are broken.
 *
 * decodeURIComponent throws on a stray `%` and a half-written mailto: is not
 * worth losing the send over, since the address is usually plain ASCII and
 * unchanged by decoding.
 */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The address and subject out of a stored unsubscribe mailto.
 *
 * news.issues.unsubscribe_email holds what was inside `<mailto:…>` with the
 * scheme stripped and the query kept on the end, undecoded:
 * `unsub@thepaper.com?subject=unsubscribe%20me`. So the first `?` splits the
 * two halves and each is decoded here.
 *
 * The query is read by hand rather than through URLSearchParams because a
 * mailto query is percent-encoded rather than form-encoded (RFC 6068): a `+`
 * in it is a literal plus, and URLSearchParams would turn it into a space.
 *
 * Null when what is stored has no address in it. The column's check
 * constraint already refuses that, so it means the caller passed something
 * that did not come from the column.
 */
export function parseUnsubscribeMailto(
  stored: string,
): { to: string; subject: string } | null {
  const mark = stored.indexOf('?');
  const to = decoded((mark === -1 ? stored : stored.slice(0, mark)).trim());
  if (to.indexOf('@') < 1 || /\s/.test(to)) return null;

  let subject = '';
  if (mark !== -1) {
    for (const pair of stored.slice(mark + 1).split('&')) {
      const equals = pair.indexOf('=');
      if (equals === -1) continue;
      if (pair.slice(0, equals).trim().toLowerCase() !== 'subject') continue;
      subject = decoded(pair.slice(equals + 1)).trim();
      break;
    }
  }

  return { to, subject: subject === '' ? DEFAULT_UNSUBSCRIBE_SUBJECT : subject };
}

/**
 * What a send produced.
 *
 * `reason` is there so the caller can tell a deployment that was never set up
 * from a publisher that refused the mail, without reading the sentence. #667
 * shows `detail` and records the time only on `ok`.
 */
export type UnsubscribeSendResult =
  | {
      ok: true;
      from: string;
      to: string;
      subject: string;
      status: number;
      /** Mailgun's id for the queued message, when it named one. */
      messageId: string | null;
    }
  | {
      ok: false;
      reason: 'unconfigured' | 'unusable_address' | 'unreachable' | 'refused';
      detail: string;
      status: number | null;
    };

/** The body, since a mail with nothing in it reads as a mistake at the other end. */
const BODY = 'Please remove this address from this mailing list.';

/** Enough of a refusal to act on, without pasting a page of HTML into the UI. */
function summarize(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

/** Mailgun answers `{"id": "<…>", "message": "Queued. Thank you."}`. */
function messageIdFrom(text: string): string | null {
  try {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data.id : null;
  } catch {
    return null;
  }
}

/**
 * Write to the address a publisher offered, from the address that subscribed.
 *
 * `localPart` is the account's own, from news.addresses; the domain is the
 * deployment's, so the two are joined by newsAddress() the same way the
 * settings page shows it. `storedAddress` is the issue's unsubscribe_email
 * exactly as the column holds it.
 *
 * `domain`, `apiKey` and `fetch` are overridable so the send can be tested
 * without either variable set. Left out, each is read at the point of use.
 */
export async function sendUnsubscribeMail(options: {
  localPart: string;
  storedAddress: string;
  domain?: string | null;
  apiKey?: string | null;
  fetch?: typeof globalThis.fetch;
}): Promise<UnsubscribeSendResult> {
  const domain = options.domain === undefined ? newsDomainOrNull() : options.domain;
  const apiKey = options.apiKey === undefined ? mailgunApiKeyOrNull() : options.apiKey;

  const missing = [
    domain ? null : 'NEWS_MAIL_DOMAIN',
    apiKey ? null : 'MAILGUN_API_KEY',
  ].filter((name): name is string => name !== null);
  if (!domain || !apiKey) {
    return {
      ok: false,
      reason: 'unconfigured',
      detail:
        `This deployment cannot send mail: ${missing.join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not set. MAILGUN_API_KEY is the ` +
        'sending key from Mailgun (Send -> API keys), not the webhook signing key.',
      status: null,
    };
  }

  const parsed = parseUnsubscribeMailto(options.storedAddress);
  if (!parsed) {
    return {
      ok: false,
      reason: 'unusable_address',
      detail: 'The publisher offered no address this mail could be sent to.',
      status: null,
    };
  }

  const from = newsAddress(options.localPart, domain);
  const form = new URLSearchParams({
    from,
    to: parsed.to,
    subject: parsed.subject,
    text: BODY,
  });

  const fetchFn = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchFn(mailgunMessagesUrl(domain), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : 'The request never reached Mailgun.',
      status: null,
    };
  }

  const text = await response.text().catch(() => '');

  if (!response.ok) {
    return {
      ok: false,
      reason: 'refused',
      detail: `Mailgun answered ${response.status}. ${summarize(text)}`.trim(),
      status: response.status,
    };
  }

  return {
    ok: true,
    from,
    to: parsed.to,
    subject: parsed.subject,
    status: response.status,
    messageId: messageIdFrom(text),
  };
}
