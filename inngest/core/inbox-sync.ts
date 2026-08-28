import 'server-only';

import {
  syncEmailAccountBatch,
  syncEmailAccountIncrementalBatch,
} from '@/lib/core/inbox/sync-account';
import {
  signInboxContinueToken,
  verifyInboxContinueToken as verifyToken,
} from '@/lib/inbox/continue-token';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createServiceSupabase as createJobServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { commerceLinker } from '@/lib/inbox/linker';
import { jobLinker } from '@/lib/jobs/inbox/linker';
import type { DomainLinker } from '@/lib/core/inbox/fan-out';

/** Leave headroom under the route maxDuration for the continue fetch. */
const PUMP_BUDGET_MS = 50_000;
/** Backfill page size — larger pages + parallel ingest finish the 50s pump with fewer hops. */
const BATCH_SIZE = 20;
const INCREMENTAL_BATCH_SIZE = 40;

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
  supabase: ReturnType<typeof createCoreServiceSupabase>,
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
  supabase: ReturnType<typeof createCoreServiceSupabase>,
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
/**
 * Every workspace that wants a look at the mail.
 *
 * Each gets a client bound to its own schema, so a linker physically cannot
 * write to the other's tables -- supabase-js carries the schema in the client
 * type, and the wrong one does not typecheck.
 *
 * Adding a third workspace later means adding a line here and nothing else in
 * the sync: that is the whole point of the fan-out.
 */
function buildLinkers(): DomainLinker[] {
  return [commerceLinker(createServiceSupabase()), jobLinker(createJobServiceSupabase())];
}

/**
 * Domains of companies the job side already tracks, for the direct-outreach
 * pass. Empty is fine and common -- the query is simply skipped.
 */
async function trackedCompanyDomains(userId: string): Promise<string[]> {
  try {
    const jobs = createJobServiceSupabase();
    const { data } = await jobs
      .from('companies')
      .select('domains')
      .eq('user_id', userId)
      .limit(200);
    const domains = new Set<string>();
    for (const row of data ?? []) {
      for (const d of (row.domains as string[] | null) ?? []) {
        if (d?.trim()) domains.add(d.trim().toLowerCase());
      }
    }
    return [...domains];
  } catch (err) {
    // The outreach pass is an enhancement, not a requirement: losing it costs
    // recall on one class of mail and must not fail the sync.
    console.error('company domain lookup failed', err);
    return [];
  }
}

export async function pumpInboxSync(opts: {
  userId: string;
  accountId: string;
  jobId: string;
  origin: string;
  type?: InboxSyncJobType;
}): Promise<void> {
  let supabase: ReturnType<typeof createCoreServiceSupabase>;
  try {
    supabase = createCoreServiceSupabase();
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

    const linkers = buildLinkers();
    const companyDomains = await trackedCompanyDomains(opts.userId);

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
        linkers,
        companyDomains,
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
  const supabase = createCoreServiceSupabase();

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
