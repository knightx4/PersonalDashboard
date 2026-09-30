import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { sweepMemory } from '@/lib/memory/sweep';

// A call starts no new embedding after SWEEP_BUDGET_MS and then finishes the
// round it is on, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * Three and a half minutes. The clock fires every five, so a call that uses
 * its whole budget and the round it finishes afterwards is done before the
 * next one starts.
 */
const SWEEP_BUDGET_MS = 210_000;

/**
 * The memory sweep's clock tick (plan #1247): removes the passages of rows
 * that are gone and embeds the rows that are new or changed, for every
 * account, into core.memory_chunks.
 *
 * Called every five minutes by a pg_cron job through pg_net
 * (supabase/migrations/0136_memory_sweep.sql), as the map sweep is. GET and
 * POST both; the body is ignored. Authorised with `Authorization: Bearer
 * $CRON_SECRET`, since a call spends the account's embedding budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await sweepMemory(createCoreServiceSupabase(), {
      userId: null,
      deadline: Date.now() + SWEEP_BUDGET_MS,
    });
    return NextResponse.json({ ok: true, ...result });
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
