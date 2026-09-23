import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { ensureAccessToken, loadAccount } from '@/lib/core/inbox/sync-account';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailProvider } from '@/lib/email/providers/gmail';
import type { GmailMessageContent } from '@/lib/email/providers/types';

export type FetchedBody =
  | { ok: true; message: GmailMessageContent }
  | { ok: false; reason: string };

/**
 * One stored message's full body, fetched from Gmail on demand.
 *
 * Bodies are never stored, so anything that needs to read an email again
 * after the sync (attaching it to an order from the review queue, re-reading
 * an order confirmation) fetches it here by the message's account and Gmail
 * id, both on the `inbox_messages` view. A failure comes back as a reason
 * rather than a throw, because every caller so far has a fallback.
 */
export async function fetchMessageBody(
  core: CoreSupabaseClient,
  opts: { userId: string; accountId: string; providerMessageId: string },
): Promise<FetchedBody> {
  if (!isGmailOAuthConfigured()) {
    return { ok: false, reason: 'Gmail is not configured on this deployment.' };
  }
  try {
    const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
    const account = await loadAccount(core, opts.userId, opts.accountId);
    const accessToken = await ensureAccessToken(core, account, TOKEN_ENCRYPTION_KEY);
    const message = await gmailProvider.getMessage(accessToken, opts.providerMessageId, {
      format: 'full',
    });
    return { ok: true, message };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Gmail fetch failed.' };
  }
}
