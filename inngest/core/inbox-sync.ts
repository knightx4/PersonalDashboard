import 'server-only';

import {
  sweepAccount,
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
import { canStartAnotherBatch } from '@/lib/core/inbox/pump-budget';

/**
 * Budgeting one invocation of the pump.
 *
 * The route declares 300s (see app/api/inbox/sync). Everything here exists to
 * guarantee the pump hands off to the next invocation *before* that runs out,
 * because the hand-off is the last thing it does: if the function is killed
 * mid-batch, continueFetch() never runs, the chain stops dead, and the job sits
 * queued until it is marked stalled. That is a silent halt, not a visible
 * failure -- which is exactly what it looked like.
 *
 * The sixty seconds this used to assume is why the chain needed so many links:
 * five hops of forty-five seconds is under four minutes of reading, and the
 * host stops a function from invoking itself much past five hops. Five hops of
 * four minutes is twenty minutes, which is a mailbox rather than a sample.
 */
const PUMP_BUDGET_MS = 240_000;

/**
 * Time held back at the end of an invocation for the held-queue sweep.
 *
 * The sweep is the only work that is not urgent -- new mail is always worth
 * more than a third look at mail that would not link twice -- so it gets what
 * is left after the mailbox has been read, and never the hand-off's share.
 */
const SWEEP_BUDGET_MS = 12_000;

/**
 * Backfill page size.
 *
 * This was six, which was the right answer to the wrong problem. The measured
 * ~0.3 messages a second was not the cost of reading a message: every page,
 * however small, also ran each workspace's pass over its held queue, and that
 * pass alone was allowed twenty seconds. A page of six therefore cost about as
 * much as a page of forty, and the invocation spent its minute re-reading old
 * mail. The sweep now runs once per invocation instead, and a page is priced
 * by the messages in it again.
 *
 * Forty is a page of Gmail ids -- listing is cheap, bodies are not, and only
 * the messages Tier A cannot settle are fetched. The loop below runs as many
 * pages as the budget allows, so this is a unit of work, not a limit.
 */
const BATCH_SIZE = 40;

/** Incremental messages are usually already judged, so they stay cheap. */
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

/**
 * Hand off to the next invocation.
 *
 * Retried once, because this single request is what the rest of the import
 * hangs on: a batch is at most a few messages, but a dropped hand-off ends the
 * whole run. Smaller batches mean more hand-offs, so the per-link odds matter
 * more than they used to -- a mailbox needing two hundred of these cannot
 * afford each one to be a single attempt.
 *
 * One retry, not a loop: the caller is already near its own deadline, and a
 * job that stops is recoverable (progress is saved per page, and Import
 * resumes) whereas a function killed mid-retry is not.
 */
async function continueFetch(
  opts: { userId: string; accountId: string; jobId: string; origin: string },
  supabase: ReturnType<typeof createCoreServiceSupabase>,
): Promise<void> {
  const token = signContinue(opts);

  async function attempt(): Promise<string | null> {
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
      if (res.ok) return null;
      const text = await res.text().catch(() => '');
      console.error('inbox sync continue failed', res.status, text.slice(0, 200));
      // A rejected token or a missing route will be rejected identically next
      // time; only a server-side or transport failure is worth repeating.
      return res.status >= 500
        ? `Could not continue sync (${res.status}).`
        : `Could not continue sync (${res.status}). Try Import again.`;
    } catch (err) {
      console.error('inbox sync continue fetch failed', err);
      return err instanceof Error ? err.message : 'Could not continue sync.';
    }
  }

  const first = await attempt();
  if (first === null) return;

  const retryable = !first.includes('Try Import again');
  if (!retryable) {
    await failJob(supabase, opts.jobId, first);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = await attempt();
  if (second === null) return;

  await failJob(supabase, opts.jobId, `${second} Press Import to pick up where it stopped.`);
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

    // The worst batch seen this invocation. Gmail pages and Tier B latency vary
    // a lot between batches, so the guard is driven by what actually happened
    // rather than by an assumed rate.
    let slowestBatchMs = 0;
    let finished = false;

    for (;;) {
      // Stop while there is still time to hand off. Checking only that the
      // deadline has not passed is what let a batch start at 49s and take the
      // function past 60 -- the batch's own cost has to be part of the test.
      if (!canStartAnotherBatch({ remainingMs: deadline - Date.now(), slowestBatchMs })) {
        break;
      }

      const { data: job } = await supabase
        .from('sync_jobs')
        .select('status')
        .eq('id', opts.jobId)
        .maybeSingle();

      if (!job || job.status === 'failed' || job.status === 'completed') {
        return;
      }

      const batchStartedAt = Date.now();
      const progress = await runBatch(supabase, {
        userId: opts.userId,
        accountId: opts.accountId,
        jobId: opts.jobId,
        pageToken,
        maxMessages: batchSize,
        linkers,
        companyDomains,
      });
      slowestBatchMs = Math.max(slowestBatchMs, Date.now() - batchStartedAt);

      if (progress.error || progress.done) {
        finished = true;
        break;
      }

      pageToken = progress.nextPageToken ?? undefined;
    }

    // Whatever is left, capped: on the invocation that finishes the mailbox
    // there is a lot, and that is exactly when a held rejection is most likely
    // to find the application this run just created.
    try {
      await sweepAccount(supabase, {
        userId: opts.userId,
        accountId: opts.accountId,
        linkers,
        budgetMs: Math.min(SWEEP_BUDGET_MS, deadline - Date.now()),
      });
    } catch (err) {
      // Never fatal. This is the optional pass, and it sits directly in front
      // of the hand-off -- letting it reach the catch below would mark a job
      // failed for the one piece of work that was not the point.
      console.error('inbox sweep failed', err);
    }

    if (finished) return;

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
