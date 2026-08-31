import { after, NextResponse, type NextRequest } from 'next/server';
import { pumpInboxSync, verifyInboxContinueToken } from '@/inngest/core/inbox-sync';

export const maxDuration = 300;

/**
 * Internal continuation for background Gmail sync (backfill or incremental).
 * Authenticated via HMAC token, not the user session — so work survives
 * navigation and cookie-less chained invocations.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    accountId?: string;
    jobId?: string;
  };

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (
    !body.userId ||
    !body.accountId ||
    !body.jobId ||
    !verifyInboxContinueToken(
      { userId: body.userId, accountId: body.accountId, jobId: body.jobId },
      token,
    )
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const origin = host
    ? `${proto}://${host}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : new URL(request.url).origin;

  const { userId, accountId, jobId } = body;
  after(() => pumpInboxSync({ userId, accountId, jobId, origin }));

  return NextResponse.json({ ok: true, continued: true });
}
