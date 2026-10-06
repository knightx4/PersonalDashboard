import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runSpecAuditTick } from '@/inngest/dev/spec-audit';

export const maxDuration = 60;

/**
 * The weekly spec audit tick (plan #1524).
 *
 * Fires the spec audit routine once a week, unless an audit wrote findings or
 * was started in the last six days. Called on Mondays by pg_cron
 * (supabase/migrations/0178_spec_audit_weekly.sql), because Vercel's free
 * plan allows one cron a day. Authorised like the other cron routes, with
 * `Authorization: Bearer $CRON_SECRET`, because each fire spends the owner's
 * routine allowance.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runSpecAuditTick()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
