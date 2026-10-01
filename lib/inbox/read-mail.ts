import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { ensureAccessToken, loadAccount, type AccountRow } from '@/lib/core/inbox/access-token';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { getGmailMessageText } from '@/lib/email/providers/gmail';

/**
 * Read one message from the person's connected Gmail at the moment they ask
 * (plan #1317), so Dash can answer a question about what it says.
 *
 * Nothing here is stored. The message is fetched with format=full, its
 * readable text is cut to MAIL_TEXT_LIMIT characters, and the result goes back
 * to the caller, which hands it to the model for one answer and keeps none
 * of it (lib/ask/mail.ts).
 */

/** The most characters of a message's text that are returned. About two thousand tokens. */
export const MAIL_TEXT_LIMIT = 8_000;

export type MailReadInput = {
  /** core.email_accounts.id of the mailbox the message is in. */
  accountId: string;
  /** Gmail's message id, as search_mail returned it. */
  messageId: string;
};

export type MailMessage = {
  accountId: string;
  mailbox: string;
  messageId: string;
  from: string | null;
  to: string | null;
  subject: string | null;
  /** When Gmail received it, ISO; null only if Gmail gave no date. */
  date: string | null;
  /** The message's text, at most MAIL_TEXT_LIMIT characters. */
  text: string;
  /** True when the text was longer than MAIL_TEXT_LIMIT and was cut. */
  truncated: boolean;
  /** Opens this message in Gmail, signed in as `mailbox`. */
  gmailUrl: string;
};

export type MailReadResult =
  | { ok: true; message: MailMessage }
  | {
      ok: false;
      /** `needs_reauth`: Google refused the token, so the person must reconnect. */
      kind: 'not_found' | 'needs_reauth' | 'failed' | 'not_configured';
      /** A plain sentence saying what went wrong. */
      reason: string;
    };

/**
 * Tidy a message's text for reading and cut it to `limit` characters: line
 * endings made plain, trailing spaces and runs of blank lines removed. A cut
 * falls at the last space before the limit when there is one near it.
 */
export function boundMailText(text: string, limit = MAIL_TEXT_LIMIT): { text: string; truncated: boolean } {
  const tidy = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (tidy.length <= limit) return { text: tidy, truncated: false };
  const cut = tidy.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return { text: (space > limit - 200 ? cut.slice(0, space) : cut).trimEnd(), truncated: true };
}

/**
 * Read one message from one of the person's mailboxes.
 *
 * Runs as whoever `core` is signed in as; the mailbox is loaded by id and
 * user, so a message in someone else's mailbox is not found. Failures come
 * back as a result with a reason rather than as an exception.
 */
export async function readMail(
  core: CoreSupabaseClient,
  userId: string,
  input: MailReadInput,
): Promise<MailReadResult> {
  if (!isGmailOAuthConfigured()) {
    return { ok: false, kind: 'not_configured', reason: 'Gmail is not configured on this deployment.' };
  }

  let account: AccountRow;
  try {
    account = await loadAccount(core, userId, input.accountId);
  } catch {
    return { ok: false, kind: 'not_found', reason: 'That mailbox is not connected.' };
  }

  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(core, account, gmailOAuthEnv().TOKEN_ENCRYPTION_KEY);
  } catch {
    // ensureAccessToken has already marked the mailbox needs_reauth.
    return {
      ok: false,
      kind: 'needs_reauth',
      reason: `Gmail access for ${account.email_address} has been revoked or has expired; reconnect it in Settings.`,
    };
  }

  try {
    const message = await getGmailMessageText(accessToken, input.messageId);
    const { text, truncated } = boundMailText(message.text);
    return {
      ok: true,
      message: {
        accountId: account.id,
        mailbox: account.email_address,
        messageId: message.id,
        from: message.from,
        to: message.to,
        subject: message.subject,
        date: message.internalDate?.toISOString() ?? null,
        text,
        truncated,
        gmailUrl: gmailOpenUrl({ emailAddress: account.email_address, messageId: message.id }) as string,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/\((400|404)\)/.test(detail)) {
      return { ok: false, kind: 'not_found', reason: `No message with that id is in ${account.email_address}.` };
    }
    const refused = /\(401\)|read access was not granted/i.test(detail);
    return {
      ok: false,
      kind: refused ? 'needs_reauth' : 'failed',
      reason: refused
        ? `Gmail refused access to ${account.email_address}; reconnect it in Settings.`
        : `Reading the message in ${account.email_address} failed: ${detail}`,
    };
  }
}
