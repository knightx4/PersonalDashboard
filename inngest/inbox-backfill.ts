import 'server-only';

import { serverEnv } from '@/lib/env';
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
  return process.env.CRON_SECRET?.trim() || serverEnv().TOKEN_ENCRYPTION_KEY;
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
  const supabase = createServiceSupabase();
  const deadline = Date.now() + PUMP_BUDGET_MS;

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, sync_cursor, user_id')
    .eq('id', opts.accountId)
    .eq('user_id', opts.userId)
    .maybeSingle();

  if (!account) {
    console.error('inbox backfill: account missing', opts.accountId);
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
    }
  } catch (err) {
    console.error('inbox backfill continue fetch failed', err);
  }
}
