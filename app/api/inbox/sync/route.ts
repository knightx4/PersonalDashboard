import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { syncEmailAccountBatch } from '@/lib/inbox/sync-account';

/**
 * Run one backfill batch for a connected inbox (session-scoped, RLS applies).
 * Call repeatedly until `done` is true for a full window.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    jobId?: string;
    maxMessages?: number;
  };

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

  try {
    const progress = await syncEmailAccountBatch(supabase, {
      userId: user.id,
      accountId,
      jobId: body.jobId,
      maxMessages: body.maxMessages ?? 15,
    });
    return NextResponse.json(progress);
  } catch (err) {
    console.error('inbox sync', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
