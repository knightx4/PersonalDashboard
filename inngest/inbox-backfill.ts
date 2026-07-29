import 'server-only';

import {
  syncEmailAccountBatch,
  syncEmailAccountIncrementalBatch,
} from '@/lib/inbox/sync-account';
import {
  signInboxContinueToken,
  verifyInboxContinueToken as verifyToken,
} from '@/lib/inbox/continue-token';
import { createServiceSupabase } from '@/inngest/supabase-admin';

/** Leave headroom under the route maxDuration for the continue fetch. */
const PUMP_BUDGET_MS = 50_000;
const BATCH_SIZE = 10;
const INCREMENTAL_BATCH_SIZE = 25;

export type InboxSyncJobType = 'backfill' | 'incremental';

function continueSecret(): string {
  // Prefer CRON_SECRET when set; otherwise the same encryption key used for OAuth tokens.
  // Do not call serverEnv() — it requires DATABASE_URL, which may be unset on Vercel.
  const secret =
    process.env.CRON_SECRET?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error('CRON_SECRET or TOKEN_ENCRYPTION_KEY is required for inbox continue tokens');
  }
  return secret;
}

export function signContinue(payload: {
  userId: string;
  accountId: string;
  jobId: string;
}): string {
  return signInboxContinueToken(continueSecret(), payload);
}

export function verifyInboxContinueToken(
  payload: { userId: string; accountId: string; jobId: string },
  token: string,
): boolean {
  return verifyToken(continueSecret(), payload, token);
}

async function failJob(
  supabase: ReturnType<typeof createServiceSupabase>,
  jobId: string,
  message: string,
): Promise<void> {
  await supabase
    .from('sync_jobs')
    .update({
      status: 'failed',
      error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['queued', 'running']);
}

async function continueFetch(
  opts: { userId: string; accountId: string; jobId: string; origin: string },
  supabase: ReturnType<typeof createServiceSupabase>,
): Promise<void> {
  const token = signContinue(opts);
  try {
    const res = await fetch(`${opts.origin}/api/inbox/sync/continue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: opts.userId,
        accountId: opts.accountId,
        jobId: opts.jobId,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('inbox sync continue failed', res.status, text.slice(0, 200));
      await failJob(
        supabase,
        opts.jobId,
        `Could not continue sync (${res.status}). Try again.`,
      );
    }
  } catch (err) {
    console.error('inbox sync continue fetch failed', err);
    await failJob(
      supabase,
      opts.jobId,
      err instanceof Error ? err.message : 'Could not continue sync.',
    );
  }
}

/**
 * Process as many Gmail pages as fit in this invocation, then self-chain
 * via /api/inbox/sync/continue when more work remains.
 */
export async function pumpInboxSync(opts: {
  userId: string;
  accountId: string;
  jobId: string;
  origin: string;
  type?: InboxSyncJobType;
}): Promise<void> {
  let supabase: ReturnType<typeof createServiceSupabase>;
  try {
    supabase = createServiceSupabase();
  } catch (err) {
    console.error('inbox sync: service client failed', err);
    return;
  }

  try {
    const deadline = Date.now() + PUMP_BUDGET_MS;

    const { data: jobRow } = await supabase
      .from('sync_jobs')
      .select('id, type, status')
      .eq('id', opts.jobId)
      .maybeSingle();

    if (!jobRow || jobRow.status === 'failed' || jobRow.status === 'completed') {
      return;
    }

    const jobType = (opts.type ?? jobRow.type) as InboxSyncJobType;

    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('id, sync_page_token, user_id')
      .eq('id', opts.accountId)
      .eq('user_id', opts.userId)
      .maybeSingle();

    if (accountError) {
      console.error('inbox sync: account lookup failed', accountError);
      await failJob(
        supabase,
        opts.jobId,
        accountError.message.includes('sync_page_token')
          ? 'Database is missing a required column (sync_page_token). Apply pending migrations, then try Import again.'
          : `Could not load inbox: ${accountError.message}`,
      );
      return;
    }

    if (!account) {
      await failJob(supabase, opts.jobId, 'Inbox account missing during sync.');
      return;
    }

    let pageToken = (account.sync_page_token as string | null) ?? undefined;
    const runBatch =
      jobType === 'incremental' ? syncEmailAccountIncrementalBatch : syncEmailAccountBatch;
    const batchSize = jobType === 'incremental' ? INCREMENTAL_BATCH_SIZE : BATCH_SIZE;

    while (Date.now() < deadline) {
      const { data: job } = await supabase
        .from('sync_jobs')
        .select('status')
        .eq('id', opts.jobId)
        .maybeSingle();

      if (!job || job.status === 'failed' || job.status === 'completed') {
        return;
      }

      const progress = await runBatch(supabase, {
        userId: opts.userId,
        accountId: opts.accountId,
        jobId: opts.jobId,
        pageToken,
        maxMessages: batchSize,
      });

      if (progress.error || progress.done) {
        return;
      }

      pageToken = progress.nextPageToken ?? undefined;
    }

    await continueFetch(opts, supabase);
  } catch (err) {
    console.error('inbox sync pump failed', err);
    await failJob(
      supabase,
      opts.jobId,
      err instanceof Error ? err.message : 'Sync failed unexpectedly.',
    );
  }
}

/** @deprecated Use pumpInboxSync — kept for existing import sites. */
export async function pumpInboxBackfill(opts: {
  userId: string;
  accountId: string;
  jobId: string;
  origin: string;
}): Promise<void> {
  return pumpInboxSync({ ...opts, type: 'backfill' });
}

/**
 * Start (or no-op if already running) an incremental sync for one account.
 * Used by cron and the Settings "Sync now" button path.
 */
export async function startIncrementalSync(opts: {
  userId: string;
  accountId: string;
  origin: string;
}): Promise<{ jobId: string; alreadyRunning: boolean } | { skipped: string }> {
  const supabase = createServiceSupabase();

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, status, backfill_completed_at, sync_cursor')
    .eq('id', opts.accountId)
    .eq('user_id', opts.userId)
    .maybeSingle();

  if (!account || account.status !== 'active') {
    return { skipped: 'inactive' };
  }
  if (!account.backfill_completed_at) {
    return { skipped: 'backfill_pending' };
  }

  const { data: latest } = await supabase
    .from('sync_jobs')
    .select('id, status, updated_at, messages_seen')
    .eq('email_account_id', opts.accountId)
    .in('type', ['incremental', 'backfill'])
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const age = Date.now() - new Date(latest.updated_at as string).getTime();
    if (age < 15 * 60 * 1000) {
      return { jobId: latest.id as string, alreadyRunning: true };
    }
    await failJob(supabase, latest.id as string, 'Superseded by a new incremental sync.');
  }

  const { data: job, error } = await supabase
    .from('sync_jobs')
    .insert({
      email_account_id: opts.accountId,
      type: 'incremental',
      status: 'queued',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !job) {
    throw new Error(error?.message ?? 'Could not start incremental sync.');
  }

  // Clear any leftover page token from a prior run; keep durable historyId.
  await supabase
    .from('email_accounts')
    .update({ sync_page_token: null })
    .eq('id', opts.accountId)
    .eq('user_id', opts.userId);

  return { jobId: job.id as string, alreadyRunning: false };
}
