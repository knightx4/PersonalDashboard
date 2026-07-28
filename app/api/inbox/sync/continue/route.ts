import { NextResponse, type NextRequest } from 'next/server';
import {
  pumpInboxBackfill,
  verifyInboxContinueToken,
} from '@/inngest/inbox-backfill';

export const maxDuration = 60;

/**
 * Internal continuation for background Gmail backfill.
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

  // Await the pump in this invocation (fire-and-forget chain happens inside).
  await pumpInboxBackfill({
    userId: body.userId,
    accountId: body.accountId,
    jobId: body.jobId,
    origin,
  });

  return NextResponse.json({ ok: true, continued: true });
}
