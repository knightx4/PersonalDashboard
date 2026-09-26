import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { ensureAccessToken, loadAccount } from '@/lib/core/inbox/sync-account';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { getGmailThread, gmailProvider } from '@/lib/email/providers/gmail';
import type { GmailMessageContent } from '@/lib/email/providers/types';

export type FetchedConversation =
  | {
      ok: true;
      messages: GmailMessageContent[];
      /** The same conversation on Gmail's website, for the page's own link. */
      gmailHref: string | null;
    }
  | { ok: false; reason: string; gmailHref: string | null };

/** Gmail's ids are hex; anything else is refused before it reaches a query. */
const GMAIL_ID = /^[0-9a-f]{1,32}$/i;

/**
 * A synced conversation, read from Gmail on demand for the in-app reader.
 *
 * The id is whatever an "Open in Gmail" link names: the thread id when the
 * sync stored one, otherwise the message id. The row it matches says which
 * connected mailbox to ask, and RLS keeps that to the signed-in account's own.
 * An id that matches no synced message is not fetched at all, so the page
 * cannot be used to read arbitrary mail.
 */
export async function fetchConversation(
  core: CoreSupabaseClient,
  opts: { userId: string; gmailId: string },
): Promise<FetchedConversation> {
  if (!GMAIL_ID.test(opts.gmailId)) {
    return { ok: false, reason: 'That link does not name an email.', gmailHref: null };
  }

  const { data: row } = await core
    .from('ingested_messages')
    .select('email_account_id, thread_id, provider_message_id')
    .or(`thread_id.eq.${opts.gmailId},provider_message_id.eq.${opts.gmailId}`)
    .limit(1)
    .maybeSingle();
  if (!row) {
    return { ok: false, reason: 'This email is not one the dashboard has synced.', gmailHref: null };
  }

  const threadId = (row.thread_id as string | null) ?? null;
  const messageId = row.provider_message_id as string;
  let gmailHref: string | null = null;

  if (!isGmailOAuthConfigured()) {
    return { ok: false, reason: 'Gmail is not configured on this deployment.', gmailHref };
  }
  try {
    const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
    const account = await loadAccount(core, opts.userId, row.email_account_id as string);
    gmailHref = gmailOpenUrl({ emailAddress: account.email_address, threadId, messageId });
    const accessToken = await ensureAccessToken(core, account, TOKEN_ENCRYPTION_KEY);
    const messages = threadId
      ? await getGmailThread(accessToken, threadId)
      : [await gmailProvider.getMessage(accessToken, messageId, { format: 'full' })];
    return { ok: true, messages, gmailHref };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Gmail fetch failed.',
      gmailHref,
    };
  }
}
