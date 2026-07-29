import { after, NextResponse, type NextRequest } from 'next/server';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { pumpInboxSync, startIncrementalSync } from '@/inngest/inbox-backfill';

export const maxDuration = 60;

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return new URL(request.url).origin;
}

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Fall back so local/dev cron-less deploys can still be hit manually with
    // the token encryption key (same pattern as continue tokens).
    const fallback = process.env.TOKEN_ENCRYPTION_KEY?.trim();
    if (!fallback) return false;
    const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    return header === fallback;
  }
  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured.
  return header === secret;
}

/**
 * Periodic incremental sync for every inbox that finished its initial backfill.
 * Protected by CRON_SECRET (or TOKEN_ENCRYPTION_KEY as a local fallback).
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = requestOrigin(request);
  let supabase: ReturnType<typeof createServiceSupabase>;
  try {
    supabase = createServiceSupabase();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Service client unavailable' },
      { status: 500 },
    );
  }

  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select('id, user_id')
    .eq('status', 'active')
    .not('backfill_completed_at', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const started: string[] = [];
  const skipped: Array<{ accountId: string; reason: string }> = [];
  const running: string[] = [];

  for (const account of accounts ?? []) {
    try {
      const result = await startIncrementalSync({
        userId: account.user_id as string,
        accountId: account.id as string,
        origin,
      });
      if ('skipped' in result) {
        skipped.push({ accountId: account.id as string, reason: result.skipped });
        continue;
      }
      if (result.alreadyRunning) {
        running.push(result.jobId);
        continue;
      }
      started.push(result.jobId);
      const userId = account.user_id as string;
      const accountId = account.id as string;
      const jobId = result.jobId;
      after(() =>
        pumpInboxSync({
          userId,
          accountId,
          jobId,
          origin,
          type: 'incremental',
        }),
      );
    } catch (err) {
      skipped.push({
        accountId: account.id as string,
        reason: err instanceof Error ? err.message : 'failed',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    accounts: (accounts ?? []).length,
    started: started.length,
    alreadyRunning: running.length,
    skipped,
  });
}
