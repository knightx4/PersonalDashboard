import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { InboundMailProvider, InboundMessage } from './types';

/**
 * Mailgun, which #457 chose: it is the one of the three that receives mail on
 * a free plan.
 *
 * A route in the Mailgun dashboard matches everything sent to the domain and
 * forwards it here as `multipart/form-data`, fully parsed -- so the headers,
 * both bodies and the signature all arrive as form fields and this file never
 * sees MIME.
 */

/** HMAC-SHA256 of timestamp + token, hex, keyed with the webhook signing key. */
export function mailgunSignature(key: string, timestamp: string, token: string): string {
  return createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
}

/**
 * How stale a signed timestamp may be.
 *
 * A day, which is loose for replay protection and deliberately so. Mailgun
 * retries a delivery it got no 200 for over several hours and re-sends the
 * same signed fields, so a window of minutes would throw away exactly the
 * messages that most need to arrive. What makes a replay harmless is not the
 * window: the Message-ID is unique per account, so a message posted twice
 * lands on the row it already wrote.
 */
const MAX_AGE_SECONDS = 86_400;

export function signatureIsCurrent(timestamp: string, now: Date): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  const age = now.getTime() / 1000 - seconds;
  return age > -300 && age < MAX_AGE_SECONDS;
}

/** Constant time, and false rather than a throw when the lengths differ. */
export function signatureMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const signed = z.object({
  timestamp: z.string().min(1),
  token: z.string().min(1),
  signature: z.string().min(1),
});

/**
 * The address and display name out of a From header.
 *
 * `Someone <a@b.com>` and a bare `a@b.com` are both common, and the name is
 * whatever the sender typed -- it is stored to be shown and trusted for
 * nothing.
 */
export function parseFrom(from: string): { email: string; name: string | null } | null {
  const angled = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const email = (angled ? angled[2] : from).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const raw = angled ? angled[1].replace(/^"(.*)"$/, '$1').trim() : '';
  return { email, name: raw === '' ? null : raw.slice(0, 300) };
}

/**
 * The two things a List-Unsubscribe header can offer.
 *
 * RFC 2369 puts each entry in angle brackets and separates them with a comma:
 * `<https://thepaper.com/u/abc>, <mailto:unsub@thepaper.com?subject=unsub>`. A
 * publisher may offer either, both, or neither, and may also offer something
 * this app cannot use -- an ftp: or news: URI is allowed by the RFC -- which is
 * dropped rather than stored, since nothing downstream could act on it.
 *
 * The `mailto:` scheme comes off the address and any `?subject=` stays on it,
 * which is the shape news.issues stores (issues_unsubscribe_email_ck refuses a
 * stored scheme) and the shape #615 needs to send the mail from.
 */
function parseListUnsubscribe(value: string | null): {
  url: string | null;
  email: string | null;
} {
  let url: string | null = null;
  let email: string | null = null;

  for (const entry of value?.match(/<[^>]*>/g) ?? []) {
    const inner = entry.slice(1, -1).trim();
    // 2048 is issues_unsubscribe_url_ck's limit. A link past it is dropped
    // rather than cut, because half a link opens nothing.
    if (!url && /^https?:\/\//i.test(inner) && inner.length <= 2048) {
      url = inner;
      continue;
    }
    if (!email && /^mailto:/i.test(inner)) {
      const address = inner.slice('mailto:'.length).trim();
      // issues_unsubscribe_email_ck again: a bare `<mailto:>` would otherwise
      // fail the insert and lose the whole issue.
      if (address.indexOf('@') > 0 && address.length >= 3 && address.length <= 998) {
        email = address;
      }
    }
  }

  return { url, email };
}

/** `[["Message-Id", "<x@y>"], …]` -- what Mailgun sends under message-headers. */
function headerFrom(form: FormData, name: string): string | null {
  const raw = form.get('message-headers');
  if (typeof raw !== 'string') return null;
  const parsed = z
    .array(z.tuple([z.string(), z.unknown()]))
    .safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) return null;
  const hit = parsed.data.find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof hit?.[1] === 'string' ? hit[1] : null;
}

function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function createMailgunProvider(options: {
  signingKey: string;
  now?: () => Date;
}): InboundMailProvider {
  const now = options.now ?? (() => new Date());

  return {
    name: 'mailgun',
    async read(form: FormData): Promise<InboundMessage | 'unsigned' | 'malformed'> {
      const credentials = signed.safeParse({
        timestamp: form.get('timestamp'),
        token: form.get('token'),
        signature: form.get('signature'),
      });
      if (!credentials.success) return 'unsigned';

      const { timestamp, token, signature } = credentials.data;
      if (!signatureIsCurrent(timestamp, now())) return 'unsigned';
      if (!signatureMatches(mailgunSignature(options.signingKey, timestamp, token), signature)) {
        return 'unsigned';
      }

      const recipient = field(form, 'recipient');
      const from = field(form, 'from') ?? field(form, 'sender');
      if (!recipient || !from) return 'malformed';

      // The From header, not the envelope sender: a newsletter's envelope
      // carries a per-message bounce address, and deduping on that would file
      // every issue under a sender of its own.
      const sender = parseFrom(from);
      if (!sender) return 'malformed';

      const textBody = field(form, 'body-plain') ?? field(form, 'stripped-text');
      const htmlBody = field(form, 'body-html') ?? field(form, 'stripped-html');
      if (!textBody && !htmlBody) return 'malformed';

      // The token when the message carried no Message-ID of its own. It is
      // unique per delivery and reused across Mailgun's retries of it, which
      // is exactly the property the dedupe needs.
      const messageId = field(form, 'Message-Id') ?? headerFrom(form, 'Message-Id') ?? token;

      const unsubscribe = parseListUnsubscribe(headerFrom(form, 'List-Unsubscribe'));

      return {
        recipient,
        senderEmail: sender.email,
        senderName: sender.name,
        subject: field(form, 'subject'),
        messageId: messageId.slice(0, 998),
        textBody,
        htmlBody,
        unsubscribeUrl: unsubscribe.url,
        unsubscribeEmail: unsubscribe.email,
      };
    },
  };
}

/**
 * The signing key if this deployment has one, null if it does not.
 *
 * For the pages that want to *say* whether mail can arrive rather than act on
 * it. Without the key the inbound endpoint answers 500 to every post, so a
 * deployment missing it cannot receive at all -- and News settings used to
 * show the address anyway, next to a sentence promising that newsletters
 * signed up with it arrive here. Two newsletters and a test message were lost
 * to that promise.
 */
export function mailgunSigningKeyOrNull(): string | null {
  const parsed = z
    .object({ MAILGUN_SIGNING_KEY: z.string().min(1) })
    .safeParse(process.env);
  return parsed.success ? parsed.data.MAILGUN_SIGNING_KEY : null;
}

/**
 * The same, for delivery, which cannot carry on without it. See lib/env.ts on
 * why it is read at the point of use rather than at module scope.
 */
export function mailgunSigningKey(): string {
  const key = mailgunSigningKeyOrNull();
  if (!key) {
    throw new Error(
      'MAILGUN_SIGNING_KEY is not set, so no inbound message can be proved to have come from ' +
        'Mailgun and none will be stored. Copy it from Mailgun (Sending -> Webhooks, the HTTP ' +
        'webhook signing key, not the API key) into the Vercel project settings or .env.local.',
    );
  }
  return key;
}
