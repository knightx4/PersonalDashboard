import 'server-only';

import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { ACCOUNT_COLUMNS, ensureAccessToken, type AccountRow } from '@/lib/core/inbox/access-token';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { getGmailMessageMetadata, gmailProvider } from '@/lib/email/providers/gmail';

/**
 * Search the person's connected Gmail at the moment they ask.
 *
 * Nothing here is stored. The search runs Gmail's own messages.list in every
 * connected mailbox, reads each match's headers and preview with
 * format=metadata, and hands them back. Whatever the caller keeps is up to the
 * caller; the feature this serves keeps only Dash's answer and the links.
 *
 * The query is built from separate inputs rather than taken as a raw Gmail
 * query, so a caller (or a model) cannot reach operators it was not given.
 */

/** The most messages one search returns, across every mailbox. */
export const MAIL_SEARCH_LIMIT = 20;

export type MailSearchInput = {
  /** A name or address, matched by Gmail against the From header. */
  from?: string | null;
  /** Words the message must contain, anywhere Gmail looks. */
  words?: string | null;
  /** Earliest moment, inclusive: a Date, an ISO timestamp, or YYYY-MM-DD (UTC midnight). */
  after?: Date | string | null;
  /** Latest moment, exclusive: same forms as `after`. */
  before?: Date | string | null;
};

export type MailSearchHit = {
  /** core.email_accounts.id of the mailbox it came from. */
  accountId: string;
  /** The connected address it came from. */
  mailbox: string;
  /** Gmail's message id: what a later read of the message names. */
  messageId: string;
  threadId: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  /** When Gmail received it, ISO; null only if Gmail gave no date. */
  date: string | null;
  /** Gmail's one-line preview. */
  snippet: string;
  /** Opens this message in Gmail, signed in as `mailbox`. */
  gmailUrl: string;
};

export type MailboxProblem = {
  accountId: string;
  mailbox: string;
  /** `needs_reauth`: Google refused the token, so the person must reconnect. */
  kind: 'needs_reauth' | 'failed';
  /** A plain sentence saying what went wrong. */
  reason: string;
};

export type MailSearchResult =
  | {
      ok: true;
      /** The Gmail query that was run, for logs and tests. */
      query: string;
      /** Newest first, at most MAIL_SEARCH_LIMIT. */
      messages: MailSearchHit[];
      /** Addresses of the mailboxes that were searched successfully. */
      searched: string[];
      /** Mailboxes that could not be searched, each with its reason. */
      problems: MailboxProblem[];
      /** True when some mailbox had more matches than were read. */
      more: boolean;
    }
  | {
      ok: false;
      kind: 'no_mailbox' | 'not_configured';
      reason: string;
    };

/** Characters that would start a Gmail operator or group inside a value. */
const OPERATOR_CHARS = /["(){}:]/g;

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(OPERATOR_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function toEpochSeconds(value: Date | string): number | null {
  const date =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
        ? new Date(`${value.trim()}T00:00:00Z`)
        : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * The Gmail query for a search. Values are stripped of the characters that
 * would make them operators; words that Gmail reads as operators on their own
 * (OR, AND, a leading minus) are lowered or unhyphenated so they stay words.
 * Dates go in as epoch seconds, which Gmail reads exactly rather than as
 * midnight in California.
 */
export function mailSearchQuery(input: MailSearchInput): string {
  const parts: string[] = [];

  const from = clean(input.from);
  if (from) parts.push(from.includes(' ') ? `from:"${from}"` : `from:${from}`);

  const words = clean(input.words)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.replace(/^[-+~]+/, ''))
    .map((word) => (word === 'OR' || word === 'AND' ? word.toLowerCase() : word))
    .filter(Boolean);
  parts.push(...words);

  if (input.after) {
    const seconds = toEpochSeconds(input.after);
    if (seconds != null) parts.push(`after:${seconds}`);
  }
  if (input.before) {
    const seconds = toEpochSeconds(input.before);
    if (seconds != null) parts.push(`before:${seconds}`);
  }

  return parts.join(' ');
}

async function searchMailbox(
  core: CoreSupabaseClient,
  account: AccountRow,
  query: string,
  encryptionKey: string,
): Promise<{ hits: MailSearchHit[]; more: boolean } | MailboxProblem> {
  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(core, account, encryptionKey);
  } catch {
    // ensureAccessToken has already marked the mailbox needs_reauth.
    return {
      accountId: account.id,
      mailbox: account.email_address,
      kind: 'needs_reauth',
      reason: `Gmail access for ${account.email_address} has been revoked or has expired; reconnect it in Settings.`,
    };
  }

  try {
    const listed = await gmailProvider.listMessages(accessToken, {
      query,
      maxResults: MAIL_SEARCH_LIMIT,
    });
    const metadata = await Promise.all(
      listed.messages.map((ref) => getGmailMessageMetadata(accessToken, ref.id)),
    );
    const hits = metadata.map((message) => ({
      accountId: account.id,
      mailbox: account.email_address,
      messageId: message.id,
      threadId: message.threadId,
      from: message.from,
      to: message.to,
      subject: message.subject,
      date: message.internalDate?.toISOString() ?? null,
      snippet: message.snippet,
      gmailUrl: gmailOpenUrl({ emailAddress: account.email_address, messageId: message.id }) as string,
    }));
    return { hits, more: listed.nextPageToken != null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // A 401 is a token Google no longer honours; the scope message is a grant
    // that never included reading mail. Both are fixed by reconnecting.
    const refused = /\(401\)|read access was not granted/i.test(detail);
    return {
      accountId: account.id,
      mailbox: account.email_address,
      kind: refused ? 'needs_reauth' : 'failed',
      reason: refused
        ? `Gmail refused access to ${account.email_address}; reconnect it in Settings.`
        : `Searching ${account.email_address} failed: ${detail}`,
    };
  }
}

/**
 * Search every mailbox the person has connected, newest first.
 *
 * Runs as whoever `core` is signed in as; RLS keeps the mailboxes to theirs.
 * A mailbox that cannot be searched becomes a problem on the result rather
 * than an exception, so one revoked mailbox does not hide the others' mail.
 */
export async function searchMail(
  core: CoreSupabaseClient,
  userId: string,
  input: MailSearchInput,
): Promise<MailSearchResult> {
  const { data, error } = await core
    .from('email_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Could not read the connected mailboxes: ${error.message}`);

  const accounts = (data ?? []) as unknown as AccountRow[];
  if (accounts.length === 0) {
    return {
      ok: false,
      kind: 'no_mailbox',
      reason: 'No Gmail mailbox is connected. Connect one in Settings to search your email.',
    };
  }
  if (!isGmailOAuthConfigured()) {
    return { ok: false, kind: 'not_configured', reason: 'Gmail is not configured on this deployment.' };
  }

  const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
  const query = mailSearchQuery(input);
  const outcomes = await Promise.all(
    accounts.map((account) => searchMailbox(core, account, query, TOKEN_ENCRYPTION_KEY)),
  );

  const messages: MailSearchHit[] = [];
  const searched: string[] = [];
  const problems: MailboxProblem[] = [];
  let more = false;
  outcomes.forEach((outcome, i) => {
    if ('kind' in outcome) {
      problems.push(outcome);
      return;
    }
    searched.push(accounts[i].email_address);
    messages.push(...outcome.hits);
    more ||= outcome.more;
  });

  messages.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (messages.length > MAIL_SEARCH_LIMIT) more = true;

  return {
    ok: true,
    query,
    messages: messages.slice(0, MAIL_SEARCH_LIMIT),
    searched,
    problems,
    more,
  };
}
