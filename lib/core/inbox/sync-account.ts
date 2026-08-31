import 'server-only';

import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { gmailProvider, isGmailHistoryExpiredError } from '@/lib/email/providers/gmail';
import { candidateQuery, companyDomainQuery, incrementalFallbackQuery } from '@/lib/core/email/gmail-query';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import {
  fetchEnvelopes,
  emptyEnvelopeCounters,
  type EnvelopeCounters,
  type MessageEnvelope,
} from '@/lib/core/inbox/envelopes';
import {
  fanOut,
  sweepLinkers,
  type DomainLinker,
  type FanOutResult,
} from '@/lib/core/inbox/fan-out';

export { incrementalFallbackQuery };

/**
 * The one sync.
 *
 * There used to be two of these, one per workspace, and they did the same work
 * over the same mailbox: list, fetch, classify, link. Now there is one. It
 * fetches each message's envelope once into core and offers it to every
 * workspace's linker, each of which decides for itself whether it wants it.
 *
 * The job row, the page token and the history cursor all live in core too:
 * there is one sync run, not one per workspace, so there is one place that
 * records how far it got.
 */

export interface SyncProgress extends EnvelopeCounters {
  jobId: string;
  done: boolean;
  nextPageToken: string | null;
  query?: string;
  error?: string;
  /** What each workspace made of this batch. */
  linkers?: FanOutResult;
}

export type AccountRow = {
  id: string;
  user_id: string;
  email_address: string;
  oauth_refresh_token: string | null;
  oauth_access_token: string | null;
  token_expires_at: string | null;
  backfill_window_days: number;
  sync_cursor: string | null;
  last_synced_at: string | null;
  status: string;
};

const ACCOUNT_COLUMNS =
  'id, user_id, email_address, oauth_refresh_token, oauth_access_token, token_expires_at, backfill_window_days, sync_cursor, last_synced_at, status';

export async function loadAccount(
  supabase: CoreSupabaseClient,
  userId: string,
  accountId: string,
): Promise<AccountRow> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) throw new Error('Inbox not found.');
  return data as AccountRow;
}

/**
 * A valid access token, refreshing if the stored one has expired.
 *
 * One grant now serves both workspaces, so this is also the single place a
 * revoked token turns into `needs_reauth` -- previously each app discovered
 * that separately and told the user separately.
 */
export async function ensureAccessToken(
  supabase: CoreSupabaseClient,
  account: AccountRow,
  encryptionKey: string,
): Promise<string> {
  if (!account.oauth_refresh_token) {
    throw new Error('Inbox has no refresh token — reconnect Gmail.');
  }

  const refresh = decryptToken(account.oauth_refresh_token, encryptionKey);
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const stillValid =
    account.oauth_access_token && expiresAt - Date.now() > 60_000
      ? decryptToken(account.oauth_access_token, encryptionKey)
      : null;

  if (stillValid) return stillValid;

  try {
    const tokens = await gmailProvider.refreshAccessToken(refresh);
    await supabase
      .from('email_accounts')
      .update({
        oauth_access_token: encryptToken(tokens.accessToken, encryptionKey),
        oauth_refresh_token: encryptToken(tokens.refreshToken ?? refresh, encryptionKey),
        token_expires_at: tokens.expiresAt?.toISOString() ?? null,
        status: 'active',
      })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    return tokens.accessToken;
  } catch (err) {
    await supabase
      .from('email_accounts')
      .update({ status: 'needs_reauth' })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    throw err;
  }
}

async function ensureJob(
  supabase: CoreSupabaseClient,
  opts: { accountId: string; jobId?: string; type: 'backfill' | 'incremental' },
): Promise<{ jobId: string; prior: EnvelopeCounters }> {
  if (opts.jobId) {
    const { data } = await supabase
      .from('sync_jobs')
      .select('id, messages_seen, messages_classified, messages_parsed')
      .eq('id', opts.jobId)
      .maybeSingle();
    if (data) {
      return {
        jobId: data.id as string,
        prior: {
          seen: (data.messages_seen as number) ?? 0,
          fetched: (data.messages_classified as number) ?? 0,
          alreadyKnown: 0,
          failed: 0,
        },
      };
    }
  }

  const { data, error } = await supabase
    .from('sync_jobs')
    .insert({
      email_account_id: opts.accountId,
      type: opts.type,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Could not start sync job: ${error?.message ?? 'unknown'}`);
  return { jobId: data.id as string, prior: emptyEnvelopeCounters() };
}

async function failJob(
  supabase: CoreSupabaseClient,
  jobId: string,
  progress: SyncProgress,
  message: string,
): Promise<void> {
  await supabase
    .from('sync_jobs')
    .update({
      status: 'failed',
      error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
      messages_seen: progress.seen,
      messages_classified: progress.fetched,
    })
    .eq('id', jobId);
}

/**
 * Hand a page of envelopes to every workspace, then let core decide what
 * nobody wanted.
 */
async function processPage(
  supabase: CoreSupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    accountEmail: string;
    accessToken: string;
    messageIds: string[];
    linkers: readonly DomainLinker[];
    progress: SyncProgress;
    refetchScrubbed?: boolean;
  },
): Promise<MessageEnvelope[]> {
  const envelopes = await fetchEnvelopes(supabase, {
    accountId: opts.accountId,
    accessToken: opts.accessToken,
    messageIds: opts.messageIds,
    counters: opts.progress,
    refetchScrubbed: opts.refetchScrubbed,
  });

  opts.progress.linkers = await fanOut(opts.linkers, {
    userId: opts.userId,
    accountId: opts.accountId,
    accountEmail: opts.accountEmail,
    accessToken: opts.accessToken,
    envelopes,
  });

  // Everything has had its say, so anything nobody claimed can lose its
  // subject and sender now. See core.scrub_unclaimed_messages().
  const { error } = await supabase.rpc('scrub_unclaimed_messages');
  if (error) console.error('scrub sweep failed', error.message);

  return envelopes;
}

/**
 * One page of the initial backfill.
 *
 * Two Gmail list calls per page. The first is the union query -- order-shaped
 * subjects and recruiting senders together, because one pass over the mailbox
 * has to satisfy both workspaces. The second is the direct-outreach pass over
 * the domains of companies the job side already tracks, which catches the
 * recruiter mailing from their own address that no keyword query can.
 */
export async function syncEmailAccountBatch(
  supabase: CoreSupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    linkers: readonly DomainLinker[];
    companyDomains?: readonly string[];
    maxMessages?: number;
    jobId?: string;
    pageToken?: string | null;
  },
): Promise<SyncProgress> {
  const encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  const maxMessages = opts.maxMessages ?? 15;
  const account = await loadAccount(supabase, opts.userId, opts.accountId);
  const { jobId, prior } = await ensureJob(supabase, {
    accountId: account.id,
    jobId: opts.jobId,
    type: 'backfill',
  });

  const progress: SyncProgress = { jobId, ...prior, done: false, nextPageToken: null };

  try {
    const accessToken = await ensureAccessToken(supabase, account, encryptionKey);

    const query = candidateQuery(account.backfill_window_days);
    progress.query = query;
    const listed = await gmailProvider.listMessages(accessToken, {
      query,
      maxResults: maxMessages,
      pageToken: opts.pageToken ?? undefined,
    });

    const messageIds = listed.messages.map((m) => m.id);

    // The outreach pass only runs on the first page: it is a separate, smaller
    // result set, and re-running it for every page of the main query would
    // fetch the same ids over and over.
    if (!opts.pageToken && opts.companyDomains?.length) {
      const outreach = companyDomainQuery(opts.companyDomains, account.backfill_window_days);
      if (outreach) {
        const extra = await gmailProvider.listMessages(accessToken, {
          query: outreach,
          maxResults: maxMessages,
        });
        for (const m of extra.messages) {
          if (!messageIds.includes(m.id)) messageIds.push(m.id);
        }
      }
    }

    console.info('core sync list', {
      accountId: account.id,
      count: messageIds.length,
      nextPageToken: Boolean(listed.nextPageToken),
    });

    await processPage(supabase, {
      userId: opts.userId,
      accountId: account.id,
      accountEmail: account.email_address,
      accessToken,
      messageIds,
      linkers: opts.linkers,
      progress,
      // A backfill is an explicit "look at everything again", which is the only
      // time a scrubbed envelope is worth re-reading -- see fetchEnvelopes.
      refetchScrubbed: true,
    });

    progress.nextPageToken = listed.nextPageToken;
    progress.done = listed.nextPageToken == null || listed.messages.length === 0;

    await supabase
      .from('sync_jobs')
      .update({
        status: progress.done ? 'completed' : 'queued',
        messages_seen: progress.seen,
        messages_classified: progress.fetched,
        finished_at: progress.done ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (progress.done) {
      const profile = await gmailProvider.fetchProfile(accessToken);
      await supabase
        .from('email_accounts')
        .update({
          last_synced_at: new Date().toISOString(),
          backfill_completed_at: new Date().toISOString(),
          sync_page_token: null,
          sync_cursor: profile.historyId,
        })
        .eq('id', account.id)
        .eq('user_id', opts.userId);
    } else {
      await supabase
        .from('email_accounts')
        .update({
          last_synced_at: new Date().toISOString(),
          sync_page_token: progress.nextPageToken,
        })
        .eq('id', account.id)
        .eq('user_id', opts.userId);
    }

    return progress;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(supabase, jobId, progress, message);
    progress.done = true;
    progress.error = message;
    progress.nextPageToken = null;
    return progress;
  }
}

/**
 * One page of Gmail history, or a date-bounded fallback when the cursor has
 * expired. Advances sync_cursor to the latest historyId.
 *
 * History is query-independent -- it returns everything new -- so the union
 * query above only matters for the backfill and for the fallback. Which is
 * convenient: day to day, both workspaces see every new message and each
 * decides for itself, with no keyword list standing between them and it.
 */
export async function syncEmailAccountIncrementalBatch(
  supabase: CoreSupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    linkers: readonly DomainLinker[];
    maxMessages?: number;
    jobId?: string;
  },
): Promise<SyncProgress> {
  const encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  const maxMessages = opts.maxMessages ?? 25;
  const account = await loadAccount(supabase, opts.userId, opts.accountId);
  const { jobId, prior } = await ensureJob(supabase, {
    accountId: account.id,
    jobId: opts.jobId,
    type: 'incremental',
  });

  const progress: SyncProgress = { jobId, ...prior, done: true, nextPageToken: null };

  try {
    const accessToken = await ensureAccessToken(supabase, account, encryptionKey);

    let messageIds: string[] = [];
    let nextHistoryId: string | null = account.sync_cursor;

    if (!account.sync_cursor) {
      const query = incrementalFallbackQuery(account.last_synced_at);
      progress.query = query;
      const listed = await gmailProvider.listMessages(accessToken, { query, maxResults: maxMessages });
      messageIds = listed.messages.map((m) => m.id);
      nextHistoryId = (await gmailProvider.fetchProfile(accessToken)).historyId;
    } else {
      try {
        const page = await gmailProvider.listHistory(accessToken, {
          startHistoryId: account.sync_cursor,
          maxResults: maxMessages,
        });
        messageIds = page.messageIds;
        nextHistoryId = page.historyId ?? account.sync_cursor;
      } catch (err) {
        if (!isGmailHistoryExpiredError(err)) throw err;
        // The cursor aged out (Gmail keeps roughly a week). Fall back to a
        // date-bounded search rather than losing the window entirely.
        const query = incrementalFallbackQuery(account.last_synced_at);
        progress.query = query;
        const listed = await gmailProvider.listMessages(accessToken, {
          query,
          maxResults: maxMessages,
        });
        messageIds = listed.messages.map((m) => m.id);
        nextHistoryId = (await gmailProvider.fetchProfile(accessToken)).historyId;
      }
    }

    await processPage(supabase, {
      userId: opts.userId,
      accountId: account.id,
      accountEmail: account.email_address,
      accessToken,
      messageIds,
      linkers: opts.linkers,
      progress,
    });

    await supabase
      .from('sync_jobs')
      .update({
        status: 'completed',
        messages_seen: progress.seen,
        messages_classified: progress.fetched,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await supabase
      .from('email_accounts')
      .update({ last_synced_at: new Date().toISOString(), sync_cursor: nextHistoryId })
      .eq('id', account.id)
      .eq('user_id', opts.userId);

    return progress;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(supabase, jobId, progress, message);
    progress.error = message;
    return progress;
  }
}

/**
 * The held-queue pass, once for an invocation rather than once per page.
 *
 * It needs a Gmail token and the connected address, which live behind
 * `loadAccount` -- so it goes here, beside the batch runners, rather than in
 * the pump. The token is almost always the cached one, so this is a row read
 * and nothing more.
 */
export async function sweepAccount(
  supabase: CoreSupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    linkers: readonly DomainLinker[];
    budgetMs: number;
  },
): Promise<void> {
  if (opts.budgetMs <= 0) return;
  if (!opts.linkers.some((linker) => linker.sweep)) return;

  const encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  const account = await loadAccount(supabase, opts.userId, opts.accountId);
  const accessToken = await ensureAccessToken(supabase, account, encryptionKey);

  await sweepLinkers(opts.linkers, {
    userId: opts.userId,
    accountId: account.id,
    accountEmail: account.email_address,
    accessToken,
    budgetMs: opts.budgetMs,
  });
}
