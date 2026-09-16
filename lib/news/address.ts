/**
 * The address newsletters are sent to, and how to read one back.
 *
 * Only the local part is stored per account. The domain belongs to the
 * deployment: it is the same for everybody, it is decided once when the mail
 * service is pointed at it, and a copy on every row would need a migration the
 * day it changes. So the two halves are joined here and nowhere else.
 */
import { z } from 'zod';

/** Lowercase letters and digits only, 16 to 40 of them. Matches the column's check. */
export const LOCAL_PART = /^[a-z0-9]{16,40}$/;

/**
 * The domain the mail service delivers for, e.g. `in.example.com`.
 *
 * Read at the point of use rather than at module scope, for the reason lib/env
 * gives: `next build` imports every route, and a build should only have to
 * compile.
 */
export function newsDomain(): string {
  const { NEWS_MAIL_DOMAIN } = z
    .object({ NEWS_MAIL_DOMAIN: z.string().min(3) })
    .parse(process.env);
  return NEWS_MAIL_DOMAIN.toLowerCase();
}

/** The whole address, as it is shown and as it is signed up with. */
export function newsAddress(localPart: string, domain: string): string {
  return `${localPart}@${domain}`;
}

/**
 * The local part of a delivery, or null when the address is not one of ours.
 *
 * A recipient arrives as whatever the sending system wrote: `A <x@y>`, mixed
 * case, sometimes several separated by commas when the mail was sent to more
 * than one of them. Only the first that sits on our domain is read, because a
 * message addressed to this app and to somebody else is still one delivery
 * here.
 *
 * Plus addressing is not honoured. The column allows no `+` at all, so
 * `mine+news@…` is a different address rather than a tag on this one, and
 * reading it as a tag would deliver mail nobody signed up for.
 */
export function localPartOf(recipient: string, domain: string): string | null {
  for (const part of recipient.split(',')) {
    const angled = part.match(/<([^>]*)>/);
    const address = (angled ? angled[1] : part).trim().toLowerCase();
    const at = address.lastIndexOf('@');
    if (at < 1) continue;
    if (address.slice(at + 1) !== domain.toLowerCase()) continue;
    const local = address.slice(0, at);
    if (LOCAL_PART.test(local)) return local;
  }
  return null;
}
