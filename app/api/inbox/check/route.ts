import { after, NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { pumpInboxSync, startIncrementalSync } from '@/inngest/core/inbox-sync';
import {
  mailCheckStatus,
  type CheckAccount,
  type CheckJob,
  type MailCheckStatus,
} from '@/lib/core/inbox/mail-check';

export const maxDuration = 300;

/**
 * Check mail now, from the account menu (plan #3019).
 *
 * GET says what the section should show: whether a check is running, when
 * mail was last checked, what the latest check found per workspace, and
 * anything wrong. POST starts a check of every connected mailbox, the same
 * incremental sync the daily job runs (inngest/cron/inbox.ts), joining one
 * that is already running and refusing a second within a minute of the last.
 */

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return new URL(request.url).origin;
}

async function loadStatus(
  supabase: Awaited<ReturnType<typeof createCoreClient>>,
  userId: string,
): Promise<{ status: MailCheckStatus; accounts: CheckAccount[] }> {
  const { data: accountRows } = await supabase
    .from('email_accounts')
    .select('id, email_address, status, last_synced_at, backfill_completed_at')
    .eq('user_id', userId)
    .neq('status', 'disconnected');
  const accounts = (accountRows ?? []) as CheckAccount[];

  let jobs: CheckJob[] = [];
  if (accounts.length > 0) {
    const { data: jobRows } = await supabase
      .from('sync_jobs')
      .select('email_account_id, status, error, linked, started_at, created_at, updated_at')
      .in(
        'email_account_id',
        accounts.map((a) => a.id),
      )
      .eq('type', 'incremental')
      .order('created_at', { ascending: false })
      .limit(5 * accounts.length);
    jobs = (jobRows ?? []) as CheckJob[];
  }

  return { status: mailCheckStatus(accounts, jobs, Date.now()), accounts };
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const supabase = await createCoreClient();
  const { status } = await loadStatus(supabase, user.id);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const supabase = await createCoreClient();
  const { status, accounts } = await loadStatus(supabase, user.id);

  if (status.running) return NextResponse.json({ ...status, joined: true });
  if (status.nextAllowedAt) {
    return NextResponse.json(
      { ...status, error: 'Mail was checked under a minute ago.' },
      { status: 429 },
    );
  }

  const origin = requestOrigin(request);
  const ready = accounts.filter((a) => a.status === 'active' && a.backfill_completed_at);
  const failures: string[] = [];
  for (const account of ready) {
    try {
      const started = await startIncrementalSync({ userId: user.id, accountId: account.id, origin });
      if ('skipped' in started || started.alreadyRunning) continue;
      const jobId = started.jobId;
      after(() =>
        pumpInboxSync({ userId: user.id, accountId: account.id, jobId, origin, type: 'incremental' }),
      );
    } catch (err) {
      failures.push(`${account.email_address}: ${err instanceof Error ? err.message : 'could not start'}`);
    }
  }

  const { status: after_ } = await loadStatus(supabase, user.id);
  return NextResponse.json({
    ...after_,
    ...(failures.length > 0 ? { error: `Could not start a check of ${failures.join('; ')}` } : {}),
  });
}
