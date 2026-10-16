import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { refreshCourseBands } from '@/lib/learn/evidence/course-band-store';

// Haiku calls four at a time; a transcript of ninety-five takes about a minute.
export const maxDuration = 300;

const BUDGET_MS = 240_000;
const ownerSchema = z.object({ userId: z.string() });

/**
 * Names the frame topics of every graded course not yet named and marks them
 * as a band (plan #2172.4.1), for the owner, the account the dev tooling runs
 * as. The daily run does the same thirty courses at a time; this fills a
 * transcript in one go. Call it again while `remaining` is above zero.
 *
 * Fired by hand, never on a clock, because every call spends: with
 * `Authorization: Bearer $CRON_SECRET`, like the other cron routes.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  try {
    const { data } = await createServiceSupabase().rpc('app_owner');
    const owner = ownerSchema.safeParse(data);
    if (!owner.success) return NextResponse.json({ error: 'no owner account' }, { status: 500 });
    const result = await refreshCourseBands(createLearnServiceSupabase(), owner.data.userId, {
      anthropicApiKey: apiKey,
      deadline: Date.now() + BUDGET_MS,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
