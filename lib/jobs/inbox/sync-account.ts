import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import {
  companyDomainQuery,
  incrementalFallbackQuery,
  recruitingCandidateQuery,
} from '@/lib/jobs/email/providers/gmail-query';
import { gmailProvider, isGmailHistoryExpiredError } from '@/lib/jobs/email/providers/gmail';
import {
  emptyCounters,
  ingestGmailMessageIds,
  type IngestCounters,
} from '@/lib/jobs/inbox/ingest-messages';
import { loadCompanies, loadLinkCandidates } from '@/lib/jobs/inbox/link-candidates';

export interface SyncProgress extends IngestCounters {
  jobId: string;
  done: boolean;
  nextPageToken?: string | null;
  query?: string;
  error?: string;
  historyExpired?: boolean;
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

export async function ensureAccessToken(
  supabase: AppSupabaseClient,
  account: AccountRow,
  encryptionKey: string,
): Promise<string> {
  if (!account.oauth_refresh_token) {
    throw new Error('This inbox has no refresh token — reconnect Gmail.');
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
  } catch (error) {
    // invalid_grant means the user revoked access or the OAuth app is still in
    // Testing status, where Google expires refresh tokens every seven days.
    await supabase
      .from('email_accounts')
      .update({ status: 'needs_reauth' })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    throw error;
  }
}

async function loadAccount(
  supabase: AppSupabaseClient,
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

async function ensureJob(
  supabase: AppSupabaseClient,
  opts: { accountId: string; jobId?: string; type: 'backfill' | 'incremental' },
): Promise<{ jobId: string; prior: IngestCounters }> {
  if (!opts.jobId) {
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
    if (error || !data) throw new Error(error?.message ?? 'Could not start the sync job.');
    return { jobId: data.id as string, prior: emptyCounters() };
  }

  const { data } = await supabase
    .from('sync_jobs')
    .select('messages_seen, messages_classified, messages_parsed')
    .eq('id', opts.jobId)
    .maybeSingle();
  await supabase.from('sync_jobs').update({ status: 'running' }).eq('id', opts.jobId);

  return {
    jobId: opts.jobId,
    prior: {
      ...emptyCounters(),
      messagesSeen: (data?.messages_seen as number) ?? 0,
      messagesClassified: (data?.messages_classified as number) ?? 0,
      messagesParsed: (data?.messages_parsed as number) ?? 0,
    },
  };
}

async function failJob(
  supabase: AppSupabaseClient,
  jobId: string,
  progress: IngestCounters,
  message: string,
): Promise<void> {
  await supabase
    .from('sync_jobs')
    .update({
      status: 'failed',
      error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
      messages_seen: progress.messagesSeen,
      messages_classified: progress.messagesClassified,
      messages_parsed: progress.messagesParsed,
    })
    .eq('id', jobId);
}

async function buildContext(supabase: AppSupabaseClient, userId: string, accountId: string, accessToken: string, counters: IngestCounters) {
  const [companies, candidates] = await Promise.all([
    loadCompanies(supabase, userId),
    loadLinkCandidates(supabase, userId),
  ]);
  return {
    userId,
    accountId,
    accessToken,
    companies: companies.map((c) => ({ id: c.id, slug: c.slug, name: c.name, domains: c.domains })),
    candidates,
    counters,
  };
}

/**
 * One page of the initial backfill.
 *
 * Two Gmail queries run per page: the ATS/keyword pass, and — once the user has
 * companies on file — the direct-outreach pass over their domains. The second
 * catches the class the first structurally cannot, and its cost is one extra
 * list call per page.
 */
export async function syncEmailAccountBatch(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    maxMessages?: number;
    jobId?: string;
    pageToken?: string | null;
  },
): Promise<SyncProgress> {
  const encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  const maxMessages = opts.maxMessages ?? 20;
  const account = await loadAccount(supabase, opts.userId, opts.accountId);
  const { jobId, prior } = await ensureJob(supabase, {
    accountId: account.id,
    jobId: opts.jobId,
    type: 'backfill',
  });

  const progress: SyncProgress = { jobId, ...prior, done: false, nextPageToken: null };

  try {
    const accessToken = await ensureAccessToken(supabase, account, encryptionKey);
    const ctx = await buildContext(supabase, opts.userId, account.id, accessToken, progress);

    const query = recruitingCandidateQuery(account.backfill_window_days);
    progress.query = query;

    const listed = await gmailProvider.listMessages(accessToken, {
      query,
      maxResults: maxMessages,
      pageToken: opts.pageToken ?? undefined,
    });

    await ingestGmailMessageIds(supabase, ctx, listed.messages.map((m) => m.id));

    // The direct-outreach pass. Only on the first page of the backfill: it is a
    // small, bounded result set and paging it alongside the main query would
    // interleave two cursors in one column.
    if (!opts.pageToken) {
      const domains = ctx.companies.flatMap((c) => c.domains);
      const outreachQuery = companyDomainQuery(domains, account.backfill_window_days);
      if (outreachQuery) {
        const outreach = await gmailProvider.listMessages(accessToken, {
          query: outreachQuery,
          maxResults: 50,
        });
        await ingestGmailMessageIds(supabase, ctx, outreach.messages.map((m) => m.id));
      }
    }

    progress.nextPageToken = listed.nextPageToken;
    progress.done = listed.nextPageToken == null || listed.messages.length === 0;

    await supabase
      .from('sync_jobs')
      .update({
        status: progress.done ? 'completed' : 'queued',
        messages_seen: progress.messagesSeen,
        messages_classified: progress.messagesClassified,
        messages_parsed: progress.messagesParsed,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(supabase, jobId, progress, message);
    return { ...progress, done: true, error: message, nextPageToken: null };
  }
}

/**
 * One page of incremental sync.
 *
 * historyId as the cursor, with a date-bounded fallback when Gmail says the
 * cursor is too old.
 *
 * The cron runs this once a day, which is a plan constraint rather than a
 * design choice: sub-daily schedules need a Vercel Pro plan. Scheduling mail is
 * the one class where that latency has a real cost — an interview invite seen a
 * day late is materially worse than a rejection seen a day late — so Settings
 * has a "Check now" button that runs exactly this, on demand and for free.
 */
export async function syncEmailAccountIncrementalBatch(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    maxMessages?: number;
    jobId?: string;
    pageToken?: string | null;
  },
): Promise<SyncProgress> {
  const encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  const maxMessages = opts.maxMessages ?? 40;
  const account = await loadAccount(supabase, opts.userId, opts.accountId);
  const { jobId, prior } = await ensureJob(supabase, {
    accountId: account.id,
    jobId: opts.jobId,
    type: 'incremental',
  });

  const progress: SyncProgress = { jobId, ...prior, done: false, nextPageToken: null };

  try {
    const accessToken = await ensureAccessToken(supabase, account, encryptionKey);
    const ctx = await buildContext(supabase, opts.userId, account.id, accessToken, progress);

    let messageIds: string[] = [];
    let nextPageToken: string | null = null;
    let nextHistoryId: string | null = account.sync_cursor;

    const runFallback = async (): Promise<void> => {
      progress.historyExpired = true;
      const query = incrementalFallbackQuery(account.last_synced_at);
      progress.query = query;
      const listed = await gmailProvider.listMessages(accessToken, {
        query,
        maxResults: maxMessages,
        pageToken: opts.pageToken ?? undefined,
      });
      messageIds = listed.messages.map((m) => m.id);
      nextPageToken = listed.nextPageToken;
      nextHistoryId = (await gmailProvider.fetchProfile(accessToken)).historyId;
    };

    if (!account.sync_cursor) {
      await runFallback();
    } else {
      try {
        const page = await gmailProvider.listHistory(accessToken, {
          startHistoryId: account.sync_cursor,
          maxResults: maxMessages,
          pageToken: opts.pageToken ?? undefined,
        });
        messageIds = page.messageIds;
        nextPageToken = page.nextPageToken;
        nextHistoryId = page.historyId ?? account.sync_cursor;
      } catch (error) {
        if (!isGmailHistoryExpiredError(error)) throw error;
        await runFallback();
      }
    }

    await ingestGmailMessageIds(supabase, ctx, messageIds);

    progress.nextPageToken = nextPageToken;
    progress.done = nextPageToken == null;

    if (progress.done && !nextHistoryId) {
      nextHistoryId = (await gmailProvider.fetchProfile(accessToken)).historyId;
    }

    await supabase
      .from('sync_jobs')
      .update({
        status: progress.done ? 'completed' : 'queued',
        messages_seen: progress.messagesSeen,
        messages_classified: progress.messagesClassified,
        messages_parsed: progress.messagesParsed,
        finished_at: progress.done ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await supabase
      .from('email_accounts')
      .update({
        last_synced_at: new Date().toISOString(),
        sync_page_token: progress.done ? null : progress.nextPageToken,
        // Hold the original cursor until the walk finishes, so later history
        // pages still page correctly.
        ...(progress.done ? { sync_cursor: nextHistoryId } : {}),
      })
      .eq('id', account.id)
      .eq('user_id', opts.userId);

    return progress;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(supabase, jobId, progress, message);
    return { ...progress, done: true, error: message, nextPageToken: null };
  }
}
