import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import { brokerRoutine } from '@/lib/feedback/routine';
import { advanceWakeTest } from '@/lib/threads/broker-wake-test';

export const maxDuration = 60;

/**
 * The broker wake-time measurement (plan #2789.3).
 *
 * Not on any schedule and never public: authorised like the cron routes with
 * `Authorization: Bearer $CRON_SECRET`, because each trial fires the broker's
 * wake-up task and spends the owner's routine allowance.
 *
 *   ?start=1        begin a run of ten trials (fires the first)
 *   no parameter    advance the run: fire the next trial once the last has
 *                   replied or timed out, and return the report so far
 *
 * Call it every minute or two until the report says `finished`. See
 * lib/threads/broker-wake-test.ts.
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const report = await advanceWakeTest({
      client: createServiceSupabase(),
      core: createServiceSchemaSupabase('core'),
      routine: brokerRoutine(),
      now: Date.now(),
      start: new URL(request.url).searchParams.get('start') === '1',
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
