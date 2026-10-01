import type { MailSearchHit, MailSearchInput } from '@/lib/inbox/search-mail';
import type { MailMessage } from '@/lib/inbox/read-mail';
import { wallClockToInstant } from '@/lib/todo/time';
import { AskInputError, optionalDate, optionalString, type AskContext, type AskToolResult } from './db';

/**
 * search_mail (plan #1316): Dash searching the person's connected Gmail at
 * the moment they ask, through lib/inbox/search-mail.ts. read_mail (plan
 * #1317): Dash opening one message it found to read its text, through
 * lib/inbox/read-mail.ts.
 *
 * What the model reads and what is kept are kept apart on purpose. The rows'
 * `detail` carries each message's subject and Gmail's preview, which go to
 * the model for this one answer, and read_mail's carries the message's text
 * as well. The row's title, which becomes the citation saved with the answer,
 * is only the sender and the day; and `kept` replaces the whole result in the
 * saved tool call with a count. So
 * nothing from a message reaches the database except what Dash writes in its
 * answer and the link to the message.
 *
 * No `server-only` here: the search itself arrives on the context
 * (`ctx.searchMail`), as does the read (`ctx.readMail`), each bound to the
 * signed-in person by lib/talk/ask-request.ts and a stub in tests.
 */

/** The `table` a mail row carries. Not a table in the database: the message lives in Gmail. */
export const MAIL_TABLE = 'gmail';

/** The ref of a message: the mailbox it is in and Gmail's id for it, which together name it. */
export function mailRef(accountId: string, messageId: string): string {
  return `${accountId}:${messageId}`;
}

/** The person's own name for a sender: the display name of `Jane Doe <jane@x.com>`, or the address. */
export function senderName(header: string | null): string {
  if (!header) return 'an unknown sender';
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(header);
  if (angled) return angled[1].trim() || angled[2].trim();
  return header.trim();
}

/** A moment as the person's local day and clock, "2026-09-28 14:05", for the model to read. */
function localStamp(iso: string, timezone: string | undefined): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

/** A moment as the person's local day in words, "28 Sep 2026", for the citation under the answer. */
function localDay(iso: string, timezone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone ?? 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Midnight at the start of a local day, as the instant Gmail is asked about. */
function startOfDay(day: string, timezone: string | undefined): string {
  return timezone ? wallClockToInstant(day, '00:00', timezone) : `${day}T00:00:00.000Z`;
}

/** The parts of a mail row that are kept as its citation: sender and day, never the subject. */
function citation(
  message: Pick<MailSearchHit, 'accountId' | 'messageId' | 'from' | 'date' | 'gmailUrl'>,
  timezone: string | undefined,
) {
  const sender = senderName(message.from);
  return {
    table: MAIL_TABLE,
    ref: mailRef(message.accountId, message.messageId),
    title: message.date ? `Email from ${sender}, ${localDay(message.date, timezone)}` : `Email from ${sender}`,
    href: message.gmailUrl,
  };
}

function row(hit: MailSearchHit, timezone: string | undefined, showMailbox: boolean) {
  return {
    ...citation(hit, timezone),
    detail: {
      from: hit.from,
      to: hit.to,
      subject: hit.subject,
      received: hit.date ? localStamp(hit.date, timezone) : null,
      preview: hit.snippet || null,
      ...(showMailbox ? { mailbox: hit.mailbox } : {}),
    },
  };
}

export async function mailLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  if (!ctx.searchMail) return { ok: false, error: 'Email cannot be searched from here.' };

  const after = optionalDate(input, 'after');
  const before = optionalDate(input, 'before');
  if (after && before && before <= after) {
    throw new AskInputError('before must be a later day than after.');
  }
  const search: MailSearchInput = {
    from: optionalString(input, 'from'),
    words: optionalString(input, 'words'),
    after: after ? startOfDay(after, ctx.timezone) : null,
    before: before ? startOfDay(before, ctx.timezone) : null,
  };

  const found = await ctx.searchMail(search);
  if (!found.ok) {
    return {
      ok: false,
      error:
        found.kind === 'no_mailbox'
          ? 'No Gmail mailbox is connected, so there is no email to search. Tell the person they can connect one in Settings.'
          : 'Gmail is not set up on this deployment, so email cannot be searched.',
    };
  }

  const showMailbox = found.searched.length + found.problems.length > 1;
  const rows = found.messages.map((hit) => row(hit, ctx.timezone, showMailbox));
  const notes = [
    found.more ? `More messages matched than the ${rows.length} listed; narrow by sender, words or dates to see older ones.` : null,
    ...found.problems.map((problem) => problem.reason),
  ].filter(Boolean);

  return {
    ok: true,
    rows,
    totals: { listed: rows.length, mailboxes_searched: found.searched.length },
    ...(notes.length ? { note: notes.join(' ') } : {}),
    // Kept on the saved tool call in place of all of the above.
    kept: { matched: rows.length },
  };
}

/** A message's ref split back into the mailbox and Gmail's id, or null when it is not one. */
export function parseMailRef(ref: string): { accountId: string; messageId: string } | null {
  const match = /^([0-9A-Za-z-]+):([0-9A-Za-z]+)$/.exec(ref.trim());
  return match ? { accountId: match[1], messageId: match[2] } : null;
}

function readRow(message: MailMessage, timezone: string | undefined) {
  return {
    ...citation(message, timezone),
    detail: {
      from: message.from,
      to: message.to,
      subject: message.subject,
      received: message.date ? localStamp(message.date, timezone) : null,
      text: message.text || null,
    },
  };
}

export async function readMailLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  if (!ctx.readMail) return { ok: false, error: 'Email cannot be read from here.' };

  const ref = optionalString(input, 'ref');
  const named = ref ? parseMailRef(ref) : null;
  if (!named) throw new AskInputError('ref must be the ref search_mail returned for the message.');

  const read = await ctx.readMail(named);
  if (!read.ok) {
    return {
      ok: false,
      error:
        read.kind === 'not_configured'
          ? 'Gmail is not set up on this deployment, so email cannot be read.'
          : read.kind === 'not_found'
            ? `${read.reason} Find the message with search_mail and pass the ref it returns.`
            : read.reason,
    };
  }

  const { message } = read;
  const notes = [
    message.text ? null : 'The message has no text that can be read; answer from its sender, subject and date.',
    message.truncated ? 'The text is long and was cut; what is shown is its beginning.' : null,
  ].filter(Boolean);

  return {
    ok: true,
    rows: [readRow(message, ctx.timezone)],
    ...(notes.length ? { note: notes.join(' ') } : {}),
    // Kept on the saved tool call in place of the text: only that one was opened.
    kept: { opened: 1 },
  };
}
