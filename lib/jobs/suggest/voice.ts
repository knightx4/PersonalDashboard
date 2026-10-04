/**
 * How the person writes, read from mail they sent, for the outreach messages.
 *
 * The messages Dash wrote before this read like cover letters: every one
 * opened with the CV and asked for fifteen minutes, and all thirteen were
 * dismissed. A style note was the only thing the prompt had to go on, and it
 * was empty. A few short emails the person actually sent show their greeting,
 * their sentence length and how formal they are better than any rule can.
 *
 * Nothing here is stored by this module. The samples go into the people
 * search's prompt for that one call; the prompt is kept only when a search
 * runs out of time and is finished as a batch, alongside the CV and goals it
 * already carries.
 */
import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { ACCOUNT_COLUMNS, ensureAccessToken, type AccountRow } from '@/lib/core/inbox/access-token';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { getGmailMessageText, gmailProvider } from '@/lib/email/providers/gmail';
import { pickVoiceSamples } from './voice-text';

/** Sent mail from the last year, leaving out forwards and calendar replies. */
const SENT_QUERY = 'in:sent newer_than:1y -subject:fwd -subject:accepted -subject:declined -filename:ics';
/** How many sent messages are read to find the samples. */
const READ = 25;
/** Gmail is a nicety here: a slow mailbox gives no samples rather than holding up the search. */
const BUDGET_MS = 15_000;

async function sentTexts(core: CoreSupabaseClient, account: AccountRow, key: string): Promise<string[]> {
  const token = await ensureAccessToken(core, account, key);
  const listed = await gmailProvider.listMessages(token, { query: SENT_QUERY, maxResults: READ });
  const messages = await Promise.all(
    listed.messages.map((ref) => getGmailMessageText(token, ref.id).catch(() => null)),
  );
  return messages.filter((m) => m !== null).map((m) => m.text);
}

/**
 * Up to VOICE_SAMPLES short emails the person sent, newest first; empty when
 * no mailbox is connected, Gmail is not set up, or reading fails.
 */
export async function loadVoiceSamples(core: CoreSupabaseClient, userId: string): Promise<string[]> {
  if (!isGmailOAuthConfigured()) return [];
  try {
    const { data, error } = await core.from('email_accounts').select(ACCOUNT_COLUMNS).eq('user_id', userId);
    if (error) throw new Error(error.message);
    const accounts = ((data ?? []) as unknown as AccountRow[]).filter((a) => a.status !== 'needs_reauth');
    if (accounts.length === 0) return [];
    const key = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
    const read = Promise.all(accounts.map((a) => sentTexts(core, a, key).catch(() => [] as string[])));
    const timeout = new Promise<string[][]>((resolve) => setTimeout(() => resolve([]), BUDGET_MS));
    return pickVoiceSamples((await Promise.race([read, timeout])).flat());
  } catch (err) {
    console.error('[jobs suggestions] voice samples', err instanceof Error ? err.message : err);
    return [];
  }
}
