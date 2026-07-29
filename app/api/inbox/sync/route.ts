import { after, NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { pumpInboxBackfill } from '@/inngest/inbox-backfill';
import {
  failStaleSyncJob,
  isFreshActiveJob,
  type SyncJobStaleRow,
} from '@/lib/inbox/sync-job-stale';

export const maxDuration = 60;

type JobRow = {
  id: string;
  status: string;
  messages_seen: number;
  messages_classified: number;
  messages_parsed: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return new URL(request.url).origin;
}

function jobToProgress(job: JobRow) {
  const done = job.status === 'completed' || job.status === 'failed';
  return {
    jobId: job.id,
    status: job.status,
    messagesSeen: job.messages_seen,
    messagesClassified: job.messages_classified,
    messagesParsed: job.messages_parsed,
    ordersCreated: job.messages_parsed,
    skipped: Math.max(0, job.messages_seen - job.messages_parsed),
    errors: 0,
    done,
    error: job.error ?? undefined,
    updatedAt: job.updated_at,
  };
}

/**
 * GET — poll the latest backfill job for an account (session-scoped).
 * POST — start a background backfill; returns immediately and keeps working
 * after the response via `after()` + continue chaining.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: account } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: 'Inbox not found.' }, { status: 404 });
  }

  const { data: job } = await supabase
    .from('sync_jobs')
    .select(
      'id, status, messages_seen, messages_classified, messages_parsed, error, started_at, finished_at, updated_at',
    )
    .eq('email_account_id', accountId)
    .eq('type', 'backfill')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ job: null });
  }

  let row = job as JobRow;
  const stale = await failStaleSyncJob(supabase, row as SyncJobStaleRow);
  if (stale) {
    row = { ...row, ...stale };
  }

  return NextResponse.json({ job: jobToProgress(row) });
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { accountId?: string };
  const supabase = await createClient();

  let accountId = body.accountId;
  if (!accountId) {
    const { data: account } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    accountId = account?.id;
  }

  if (!accountId) {
    return NextResponse.json({ error: 'No connected inbox.' }, { status: 400 });
  }

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, status')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account || account.status !== 'active') {
    return NextResponse.json({ error: 'Inbox not found or inactive.' }, { status: 400 });
  }

  const { data: latest } = await supabase
    .from('sync_jobs')
    .select(
      'id, status, messages_seen, messages_classified, messages_parsed, error, started_at, finished_at, updated_at',
    )
    .eq('email_account_id', accountId)
    .eq('type', 'backfill')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestJob = latest as JobRow | null;

  if (isFreshActiveJob(latestJob)) {
    return NextResponse.json({
      ...jobToProgress(latestJob!),
      alreadyRunning: true,
    });
  }

  if (latestJob) {
    await failStaleSyncJob(supabase, latestJob as SyncJobStaleRow);
  }

  const { data: job, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      email_account_id: accountId,
      type: 'backfill',
      status: 'queued',
      started_at: new Date().toISOString(),
    })
    .select(
      'id, status, messages_seen, messages_classified, messages_parsed, error, started_at, finished_at, updated_at',
    )
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: jobError?.message ?? 'Could not start sync job.' },
      { status: 500 },
    );
  }

  // Fresh backfill pages from the start of the Gmail query.
  await supabase
    .from('email_accounts')
    .update({ sync_cursor: null })
    .eq('id', accountId)
    .eq('user_id', user.id);

  const origin = requestOrigin(request);
  const jobId = job.id as string;
  const userId = user.id;

  after(() =>
    pumpInboxBackfill({
      userId,
      accountId: accountId!,
      jobId,
      origin,
    }),
  );

  return NextResponse.json({
    ...jobToProgress(job as JobRow),
    alreadyRunning: false,
  });
}
