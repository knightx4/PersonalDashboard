import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { type MerchantDomainHit } from '@/lib/email/extract/classify';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { orderCandidateQuery, incrementalFallbackQuery } from '@/lib/email/providers/gmail-query';
import {
  gmailProvider,
  isGmailHistoryExpiredError,
} from '@/lib/email/providers/gmail';
import {
  ingestGmailMessageIds,
  reprocessPendingLifecycleMessages,
  type IngestCounters,
} from '@/lib/inbox/ingest-messages';
import { loadMerchantExclusions } from '@/lib/inbox/merchant-exclusions';
import { loadMerchantsForUser } from '@/lib/merchants/resolve-order-merchant';

export { incrementalFallbackQuery } from '@/lib/email/providers/gmail-query';

export interface SyncProgress {
  jobId: string;
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  ordersCreated: number;
  skipped: number;
  errors: number;
  done: boolean;
  /** Pass back on the next pump to advance Gmail pages / history pages. */
  nextPageToken?: string | null;
  /** Gmail search used for this batch — useful when seen=0. */
  query?: string;
  error?: string;
  /** True when history cursor was stale and we fell back to a date query. */
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

async function loadMerchants(
  supabase: SupabaseClient,
  userId: string,
): Promise<MerchantDomainHit[]> {
  const rows = await loadMerchantsForUser(supabase, userId);
  return rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    domains: m.domains,
  }));
}

export async function loadCategoryContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  categoryIdsBySlug: Map<string, string>;
  categoryOptions: Array<{ slug: string; name: string }>;
}> {
  const { data: categoryRows } = await supabase
    .from('categories')
    .select('id, slug, name, user_id')
    .is('parent_id', null)
    .or(`user_id.is.null,user_id.eq.${userId}`);
  const categoryIdsBySlug = new Map<string, string>(
    (categoryRows ?? []).map((row) => [row.slug as string, row.id as string]),
  );
  const categoryOptions = (categoryRows ?? []).map((row) => ({
    slug: row.slug as string,
    name: row.name as string,
  }));
  return { categoryIdsBySlug, categoryOptions };
}

export async function ensureAccessToken(
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
  opts: {
    accountId: string;
    jobId?: string;
    type: 'backfill' | 'incremental';
  },
): Promise<{ jobId: string; prior: IngestCounters }> {
  if (!opts.jobId) {
    const { data: job, error: jobError } = await supabase
      .from('sync_jobs')
      .insert({
        email_account_id: opts.accountId,
        type: opts.type,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (jobError || !job) throw new Error(jobError?.message ?? 'Could not start sync job.');
    return {
      jobId: job.id as string,
      prior: {
        messagesSeen: 0,
        messagesClassified: 0,
        messagesParsed: 0,
        ordersCreated: 0,
        skipped: 0,
        errors: 0,
      },
    };
  }

  const { data: existingJob } = await supabase
    .from('sync_jobs')
    .select('messages_seen, messages_classified, messages_parsed')
    .eq('id', opts.jobId)
    .maybeSingle();
  await supabase.from('sync_jobs').update({ status: 'running' }).eq('id', opts.jobId);
  return {
    jobId: opts.jobId,
    prior: {
      messagesSeen: existingJob?.messages_seen ?? 0,
      messagesClassified: existingJob?.messages_classified ?? 0,
      messagesParsed: existingJob?.messages_parsed ?? 0,
      ordersCreated: 0,
      skipped: 0,
      errors: 0,
    },
  };
}

async function failJob(
  supabase: SupabaseClient,
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

async function loadAccount(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
): Promise<AccountRow> {
  const { data: account, error: accountError } = await supabase
    .from('email_accounts')
    .select(
      'id, user_id, email_address, oauth_refresh_token, oauth_access_token, token_expires_at, backfill_window_days, sync_cursor, last_synced_at, status',
    )
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (accountError || !account) {
    throw new Error('Inbox not found.');
  }
  return account as AccountRow;
}

/**
 * Process one batch of Gmail order-candidate messages for a connected account
 * (full backfill via messages.list + search query).
 */
export async function syncEmailAccountBatch(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
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

  const progress: SyncProgress = {
    jobId,
    ...prior,
    done: false,
    nextPageToken: null,
  };

  try {
    const accessToken = await ensureAccessToken(supabase, account, encryptionKey);
    const merchants = await loadMerchants(supabase, opts.userId);
    const exclusions = await loadMerchantExclusions(supabase, opts.userId);
    const { categoryIdsBySlug, categoryOptions } = await loadCategoryContext(
      supabase,
      opts.userId,
    );
    const query = orderCandidateQuery(account.backfill_window_days);
    progress.query = query;
    console.info('gmail sync query', {
      accountId: account.id,
      query,
      pageToken: Boolean(opts.pageToken),
    });
    const listed = await gmailProvider.listMessages(accessToken, {
      query,
      maxResults: maxMessages,
      pageToken: opts.pageToken ?? undefined,
    });
    console.info('gmail sync list', {
      accountId: account.id,
      count: listed.messages.length,
      nextPageToken: Boolean(listed.nextPageToken),
    });

    await ingestGmailMessageIds(supabase, {
      userId: opts.userId,
      accountId: account.id,
      accessToken,
      messageIds: listed.messages.map((m) => m.id),
      merchants,
      exclusions,
      categoryIdsBySlug,
      categoryOptions,
      counters: progress,
    });

    await reprocessPendingLifecycleMessages(supabase, {
      userId: opts.userId,
      accountId: account.id,
      accessToken,
      merchants,
      exclusions,
      categoryIdsBySlug,
      categoryOptions,
      counters: progress,
    });

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
 * Process one page of Gmail history (or a date-bounded fallback when the
 * historyId is expired). Advances sync_cursor to the latest historyId.
 */
export async function syncEmailAccountIncrementalBatch(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    maxMessages?: number;
    jobId?: string;
    pageToken?: string | null;
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

  const progress: SyncProgress = {
    jobId,
    ...prior,
    done: false,
    nextPageToken: null,
  };

  try {
    const accessToken = await ensureAccessToken(supabase, account, encryptionKey);
    const merchants = await loadMerchants(supabase, opts.userId);
    const exclusions = await loadMerchantExclusions(supabase, opts.userId);
    const { categoryIdsBySlug, categoryOptions } = await loadCategoryContext(
      supabase,
      opts.userId,
    );

    let messageIds: string[] = [];
    let nextPageToken: string | null = null;
    let nextHistoryId: string | null = account.sync_cursor;

    if (!account.sync_cursor) {
      // No baseline yet — seed from profile and treat as a short catch-up.
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
      const profile = await gmailProvider.fetchProfile(accessToken);
      nextHistoryId = profile.historyId;
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
        console.info('gmail history list', {
          accountId: account.id,
          count: messageIds.length,
          nextPageToken: Boolean(nextPageToken),
        });
      } catch (err) {
        if (!isGmailHistoryExpiredError(err)) throw err;
        progress.historyExpired = true;
        const query = incrementalFallbackQuery(account.last_synced_at);
        progress.query = query;
        console.info('gmail history expired; falling back', {
          accountId: account.id,
          query,
        });
        const listed = await gmailProvider.listMessages(accessToken, {
          query,
          maxResults: maxMessages,
          pageToken: opts.pageToken ?? undefined,
        });
        messageIds = listed.messages.map((m) => m.id);
        nextPageToken = listed.nextPageToken;
        const profile = await gmailProvider.fetchProfile(accessToken);
        nextHistoryId = profile.historyId;
      }
    }

    await ingestGmailMessageIds(supabase, {
      userId: opts.userId,
      accountId: account.id,
      accessToken,
      messageIds,
      merchants,
      exclusions,
      categoryIdsBySlug,
      categoryOptions,
      counters: progress,
    });

    await reprocessPendingLifecycleMessages(supabase, {
      userId: opts.userId,
      accountId: account.id,
      accessToken,
      merchants,
      exclusions,
      categoryIdsBySlug,
      categoryOptions,
      counters: progress,
    });

    progress.nextPageToken = nextPageToken;
    progress.done = nextPageToken == null;

    // When history returned nothing and no next page, still advance the cursor.
    if (progress.done && !nextHistoryId) {
      const profile = await gmailProvider.fetchProfile(accessToken);
      nextHistoryId = profile.historyId;
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
        // Keep the original startHistoryId until the walk finishes so later
        // history.list pages still page correctly. Same for fallback catch-up.
        ...(progress.done ? { sync_cursor: nextHistoryId } : {}),
      })
      .eq('id', account.id)
      .eq('user_id', opts.userId);

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
