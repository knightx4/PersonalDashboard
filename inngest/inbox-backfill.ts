import 'server-only';

import { syncEmailAccountBatch } from '@/lib/inbox/sync-account';
import {
  signInboxContinueToken,
  verifyInboxContinueToken as verifyToken,
} from '@/lib/inbox/continue-token';
import { createServiceSupabase } from '@/inngest/supabase-admin';

/** Leave headroom under the route maxDuration for the continue fetch. */
const PUMP_BUDGET_MS = 50_000;
const BATCH_SIZE = 10;

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

/**
 * Process as many Gmail pages as fit in this invocation, then self-chain
 * via /api/inbox/sync/continue when more work remains.
 */
export async function pumpInboxBackfill(opts: {
  userId: string;
  accountId: string;
  jobId: string;
  origin: string;
}): Promise<void> {
  let supabase: ReturnType<typeof createServiceSupabase>;
  try {
    supabase = createServiceSupabase();
  } catch (err) {
    console.error('inbox backfill: service client failed', err);
    // Best-effort: cannot mark the job without a client.
    return;
  }

  try {
    const deadline = Date.now() + PUMP_BUDGET_MS;

    const { data: account } = await supabase
      .from('email_accounts')
      .select('id, sync_cursor, user_id')
      .eq('id', opts.accountId)
      .eq('user_id', opts.userId)
      .maybeSingle();

    if (!account) {
      await failJob(supabase, opts.jobId, 'Inbox account missing during import.');
      return;
    }

    let pageToken = (account.sync_cursor as string | null) ?? undefined;

    while (Date.now() < deadline) {
      const { data: job } = await supabase
        .from('sync_jobs')
        .select('status')
        .eq('id', opts.jobId)
        .maybeSingle();

      if (!job || job.status === 'failed' || job.status === 'completed') {
        return;
      }

      const progress = await syncEmailAccountBatch(supabase, {
        userId: opts.userId,
        accountId: opts.accountId,
        jobId: opts.jobId,
        pageToken,
        maxMessages: BATCH_SIZE,
      });

      if (progress.error || progress.done) {
        return;
      }

      pageToken = progress.nextPageToken ?? undefined;
    }

    const token = signContinue(opts);
    // Await the hop so the platform does not freeze before the request leaves.
    // The continue route returns immediately and resumes via `after()`.
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
        console.error('inbox backfill continue failed', res.status, text.slice(0, 200));
        await failJob(
          supabase,
          opts.jobId,
          `Could not continue import (${res.status}). Try Import again.`,
        );
      }
    } catch (err) {
      console.error('inbox backfill continue fetch failed', err);
      await failJob(
        supabase,
        opts.jobId,
        err instanceof Error ? err.message : 'Could not continue import.',
      );
    }
  } catch (err) {
    console.error('inbox backfill pump failed', err);
    await failJob(
      supabase,
      opts.jobId,
      err instanceof Error ? err.message : 'Import failed unexpectedly.',
    );
  }
}
