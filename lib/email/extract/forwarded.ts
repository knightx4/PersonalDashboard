import { displayNameFromAddress } from './heuristic';

/**
 * Forwarded and replied emails carry the shop's original message quoted in
 * the body. The sender of the outer email is whoever forwarded or replied, so
 * reading the merchant from it names a person ("Samantha Kuo") instead of the
 * shop. This finds the quoted original and returns its sender and its text.
 *
 * Only a real quoted header counts:
 * - a header block, a `From:` line followed within a few lines by both a
 *   `Subject:` line and a `Date:` or `Sent:` line (Gmail's "Forwarded
 *   message", Outlook's rule line or "Original Message", Yahoo, Apple Mail);
 * - or a reply attribution, `On <date> <Name> <addr> wrote:` with an address.
 *
 * A `From:` line on its own, such as a shipping label's "From: Warehouse",
 * is not a header. When a thread quotes several messages, the deepest one is
 * the original and is the one returned.
 */
export type QuotedOriginal = {
  /** `"Name" <addr>`, `addr`, or `"Name" <>` when the header gave no address. */
  fromAddress: string;
  /** The quoted message's own subject, when its header carried one. */
  subject: string | null;
  /** The quoted message's text, with `>` quote markers removed. */
  text: string;
};

const QUOTE_PREFIX = /^(?:\s*>)+ ?/;
const HEADER_FIELD = /^\s*\*?(from|sent|date|to|cc|subject|reply-to)\s*:\*?\s*(.*)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const REPLY_ATTRIBUTION = /^\s*On\s.+?\bwrote:\s*$/i;

function unquote(line: string): string {
  return line.replace(QUOTE_PREFIX, '');
}

/** `Shop <a@b.com>`, `Shop [mailto:a@b.com]`, `a@b.com`, `"Shop"` → `"Shop" <a@b.com>` form. */
function normalizeSender(raw: string): string | null {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const address = value.match(EMAIL)?.[0] ?? null;
  const name = value
    .replace(/\[mailto:[^\]]*\]/i, '')
    .replace(/<[^>]*>/g, '')
    .replace(EMAIL, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
  if (address && name) return `"${name}" <${address}>`;
  if (address) return address;
  if (name) return `"${name}" <>`;
  return null;
}

type Found = { fromAddress: string; subject: string | null; bodyStart: number };

/** A header block starting at `index`, if the lines there are one. */
function headerAt(lines: readonly string[], index: number): Found | null {
  const first = HEADER_FIELD.exec(unquote(lines[index] ?? ''));
  if (!first || first[1]!.toLowerCase() !== 'from') return null;
  const fields = new Map<string, string>([['from', first[2] ?? '']]);
  let end = index + 1;
  for (; end < lines.length && end <= index + 8; end += 1) {
    const line = unquote(lines[end] ?? '');
    const field = HEADER_FIELD.exec(line);
    if (field) {
      const key = field[1]!.toLowerCase();
      if (!fields.has(key)) fields.set(key, field[2] ?? '');
      continue;
    }
    // Until the Subject: line, allow blank lines between fields (HTML rendered
    // as text) and a long To: or Cc: that Outlook wraps onto the next line.
    if (!fields.has('subject') && (!line.trim() || fields.size > 1)) continue;
    break;
  }
  if (!fields.has('subject') || !(fields.has('date') || fields.has('sent'))) return null;
  const fromAddress = normalizeSender(fields.get('from') ?? '');
  if (!fromAddress) return null;
  return {
    fromAddress,
    subject: fields.get('subject')?.trim() || null,
    bodyStart: end,
  };
}

/** A Gmail-style `On … <addr> wrote:` line at `index`, joined with the next if it wraps. */
function attributionAt(lines: readonly string[], index: number): Found | null {
  const line = unquote(lines[index] ?? '');
  if (!/^\s*On\s/i.test(line)) return null;
  let joined = line;
  let bodyStart = index + 1;
  if (!REPLY_ATTRIBUTION.test(joined) && index + 1 < lines.length) {
    joined = `${line} ${unquote(lines[index + 1] ?? '')}`;
    bodyStart = index + 2;
  }
  if (!REPLY_ATTRIBUTION.test(joined)) return null;
  const address = joined.match(EMAIL)?.[0];
  if (!address) return null;
  // The name sits between the date and the address: "…at 3:02 PM Shop <a@b>".
  const before = joined.slice(0, joined.indexOf(address)).replace(/[<\s]+$/, '');
  const name = before.match(/^.*(?:\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}),?\s+(.+)$/i)?.[1]?.trim();
  return {
    fromAddress: name ? `"${name.replace(/"/g, '')}" <${address}>` : address,
    subject: null,
    bodyStart,
  };
}

export function quotedOriginal(text: string): QuotedOriginal | null {
  const lines = text.split(/\r?\n/);
  let found: Found | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const hit = headerAt(lines, i) ?? attributionAt(lines, i);
    if (hit) {
      found = hit;
      i = Math.max(i, hit.bodyStart - 1);
    }
  }
  if (!found) return null;
  const body = lines
    .slice(found.bodyStart)
    .map(unquote)
    .join('\n')
    .trim();
  return { fromAddress: found.fromAddress, subject: found.subject, text: body };
}

type EmailToRead = {
  subject: string;
  text: string;
  fromAddress?: string | null;
  merchantName?: string | null;
};

/**
 * A forward or reply is read as the message it quotes: the quoted text, the
 * quoted subject, and the quoted sender. The caller's merchant name is dropped
 * when it was only the forwarder's display name, so the pattern reader does
 * not name the order after them; a known merchant's name is kept.
 */
export function unwrapQuotedOriginal<T extends EmailToRead>(input: T): T {
  const quoted = quotedOriginal(input.text);
  if (!quoted) return input;
  const outerDisplay = displayNameFromAddress(input.fromAddress);
  const merchantName =
    input.merchantName && input.merchantName !== outerDisplay
      ? input.merchantName
      : displayNameFromAddress(quoted.fromAddress);
  return {
    ...input,
    subject: quoted.subject ?? input.subject,
    text: quoted.text,
    fromAddress: quoted.fromAddress,
    merchantName,
  };
}
