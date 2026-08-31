import { after, NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import {
  pumpInboxSync,
  startIncrementalSync,
  type InboxSyncJobType,
} from '@/inngest/core/inbox-sync';
import { shouldResumeBackfill } from '@/lib/core/inbox/pump-budget';
import {
  failStaleSyncJob,
  isFreshActiveJob,
  type SyncJobStaleRow,
} from '@/lib/core/inbox/sync-job-stale';
import { backfillResumable, type BackfillState } from '@/lib/core/inbox/resume';

export const maxDuration = 300;

type JobRow = {
  id: string;
  type?: string;
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
    type: job.type ?? 'backfill',
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
 * Where the first scan got to, for a client that has to decide whether to ask
 * for the next stretch. The rules themselves live in lib/core/inbox/resume.
 */
function backfillStateOf(
  account: { status: string; backfill_completed_at: string | null },
  rows: JobRow[],
): BackfillState & { resumable: boolean } {
  const latest = rows.find((j) => (j.type ?? 'backfill') === 'backfill') ?? null;
  const state: BackfillState = {
    accountStatus: account.status,
    backfillCompletedAt: account.backfill_completed_at,
    latestJob: latest ? { status: latest.status, messagesSeen: latest.messages_seen } : null,
  };
  return { ...state, resumable: backfillResumable(state) };
}

const JOB_SELECT =
  'id, type, status, messages_seen, messages_classified, messages_parsed, error, started_at, finished_at, updated_at';

/**
 * GET — poll the latest sync job for an account (session-scoped).
 * Optional `type=backfill|incremental`; default prefers an active job, else latest.
 * POST — start a background sync; `mode: 'backfill' | 'incremental'` (default backfill).
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

  const typeFilter = request.nextUrl.searchParams.get('type') as InboxSyncJobType | null;

  const supabase = await createCoreClient();
  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, status, backfill_completed_at')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: 'Inbox not found.' }, { status: 404 });
  }

  let query = supabase
    .from('sync_jobs')
    .select(JOB_SELECT)
    .eq('email_account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (typeFilter === 'backfill' || typeFilter === 'incremental') {
    query = query.eq('type', typeFilter);
  }

  const { data: jobs } = await query;
  const rows = (jobs ?? []) as JobRow[];

  // Prefer a live job so the UI keeps showing progress.
  const selected =
    rows.find((j) => j.status === 'running' || j.status === 'queued') ?? rows[0] ?? null;

  if (!selected) {
    return NextResponse.json({ job: null, backfill: backfillStateOf(account, rows) });
  }

  let row = selected;
  const stale = await failStaleSyncJob(supabase, row as SyncJobStaleRow);
  if (stale) {
    row = { ...row, ...stale };
  }

  return NextResponse.json({
    job: jobToProgress(row),
    backfill: backfillStateOf(account, rows),
  });
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    mode?: InboxSyncJobType;
    /** Discard saved progress and page the mailbox from the top again. */
    reset?: boolean;
  };
  const mode: InboxSyncJobType = body.mode === 'incremental' ? 'incremental' : 'backfill';
  const supabase = await createCoreClient();
  const origin = requestOrigin(request);

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
    .select('id, status, backfill_completed_at, sync_page_token')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account || account.status !== 'active') {
    return NextResponse.json({ error: 'Inbox not found or inactive.' }, { status: 400 });
  }

  if (mode === 'incremental') {
    if (!account.backfill_completed_at) {
      return NextResponse.json(
        { error: 'Finish the initial Gmail import before Sync now.' },
        { status: 400 },
      );
    }

    try {
      const started = await startIncrementalSync({
        userId: user.id,
        accountId,
        origin,
      });
      if ('skipped' in started) {
        return NextResponse.json({ error: started.skipped }, { status: 400 });
      }

      if (!started.alreadyRunning) {
        const jobId = started.jobId;
        after(() =>
          pumpInboxSync({
            userId: user.id,
            accountId: accountId!,
            jobId,
            origin,
            type: 'incremental',
          }),
        );
      }

      const { data: job } = await supabase
        .from('sync_jobs')
        .select(JOB_SELECT)
        .eq('id', started.jobId)
        .single();

      return NextResponse.json({
        ...jobToProgress(job as JobRow),
        alreadyRunning: started.alreadyRunning,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Could not start sync.' },
        { status: 500 },
      );
    }
  }

  const { data: latest } = await supabase
    .from('sync_jobs')
    .select(JOB_SELECT)
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

  // Don't start a full backfill while incremental is mid-flight.
  const { data: activeOther } = await supabase
    .from('sync_jobs')
    .select('id')
    .eq('email_account_id', accountId)
    .eq('type', 'incremental')
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();
  if (activeOther) {
    return NextResponse.json(
      { error: 'An incremental sync is still running. Wait for it to finish.' },
      { status: 409 },
    );
  }

  const { data: job, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      email_account_id: accountId,
      type: 'backfill',
      status: 'queued',
      started_at: new Date().toISOString(),
    })
    .select(JOB_SELECT)
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: jobError?.message ?? 'Could not start sync job.' },
      { status: 500 },
    );
  }

  // Carry on from where the last run stopped.
  //
  // This used to clear sync_page_token unconditionally, which meant every
  // press of Import re-paged the mailbox from the top. Paired with a pump that
  // was dying a page or two in, the same fifty messages were fetched over and
  // over and the import could never reach the rest -- three attempts in a row
  // saw 34, 74 and 54 messages and none of them got further.
  //
  // Starting over is still available, and always was: Reset & re-scan is its
  // own button, and it also drops what was already imported, which Import must
  // not do.
  const resuming = shouldResumeBackfill({
    savedPageToken: account.sync_page_token as string | null,
    reset: body.reset,
  });
  if (!resuming) {
    await supabase
      .from('email_accounts')
      .update({ sync_page_token: null, sync_cursor: null })
      .eq('id', accountId)
      .eq('user_id', user.id);
  }

  const jobId = job.id as string;
  const userId = user.id;

  after(() =>
    pumpInboxSync({
      userId,
      accountId: accountId!,
      jobId,
      origin,
      type: 'backfill',
    }),
  );

  return NextResponse.json({
    ...jobToProgress(job as JobRow),
    alreadyRunning: false,
  });
}
