import { after, NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { pumpInboxSync, startIncrementalSync } from '@/inngest/core/inbox-sync';
import {
  mailCheckStatus,
  planCheck,
  type CheckAccount,
  type CheckJob,
  type MailCheckStatus,
} from '@/lib/core/inbox/mail-check';

export const maxDuration = 300;

/**
 * Check mail now, from the account menu (plans #3019, #3019.1).
 *
 * GET says what the section should show for each connected mailbox: whether
 * a check of it is running, when it was last checked, what its latest check
 * found per workspace, and anything wrong. POST starts a check: of one
 * mailbox when the body names `mailboxId`, of every mailbox for Check all.
 * Each is the incremental sync the daily job runs (inngest/cron/inbox.ts),
 * for that mailbox; a mailbox already being checked is joined, and one
 * checked under a minute ago is refused.
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
): Promise<MailCheckStatus> {
  const { data: accountRows } = await supabase
    .from('email_accounts')
    .select('id, email_address, status, last_synced_at, backfill_completed_at')
    .eq('user_id', userId)
    .neq('status', 'disconnected')
    .order('created_at', { ascending: true });
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

  return mailCheckStatus(accounts, jobs, Date.now());
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const supabase = await createCoreClient();
  return NextResponse.json(await loadStatus(supabase, user.id));
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { mailboxId?: unknown } | null;
  const mailboxId = typeof body?.mailboxId === 'string' ? body.mailboxId : null;

  const supabase = await createCoreClient();
  const status = await loadStatus(supabase, user.id);
  const plan = planCheck(status, mailboxId);

  if (plan.kind === 'joined') return NextResponse.json({ ...status, joined: true });
  if (plan.kind === 'wait') return NextResponse.json({ ...status, error: plan.message }, { status: 429 });
  if (plan.kind === 'none') return NextResponse.json({ ...status, error: plan.message }, { status: 409 });

  const origin = requestOrigin(request);
  const failures: string[] = [];
  for (const accountId of plan.ids) {
    try {
      const started = await startIncrementalSync({ userId: user.id, accountId, origin });
      if ('skipped' in started || started.alreadyRunning) continue;
      const jobId = started.jobId;
      after(() => pumpInboxSync({ userId: user.id, accountId, jobId, origin, type: 'incremental' }));
    } catch (err) {
      const email = status.mailboxes.find((m) => m.id === accountId)?.email ?? 'a mailbox';
      failures.push(`${email}: ${err instanceof Error ? err.message : 'could not start'}`);
    }
  }

  const next = await loadStatus(supabase, user.id);
  return NextResponse.json({
    ...next,
    ...(plan.joined ? { joined: true } : {}),
    ...(failures.length > 0 ? { error: `Could not start a check of ${failures.join('; ')}` } : {}),
  });
}
