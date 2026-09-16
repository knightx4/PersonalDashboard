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

      return {
        recipient,
        senderEmail: sender.email,
        senderName: sender.name,
        subject: field(form, 'subject'),
        messageId: messageId.slice(0, 998),
        textBody,
        htmlBody,
      };
    },
  };
}

/** The signing key, read at the point of use. See lib/env.ts on why it is lazy. */
export function mailgunSigningKey(): string {
  const { MAILGUN_SIGNING_KEY } = z
    .object({ MAILGUN_SIGNING_KEY: z.string().min(1) })
    .parse(process.env);
  return MAILGUN_SIGNING_KEY;
}
