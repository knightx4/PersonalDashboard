import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeCron } from '@/inngest/cron/authorize';
import { pumpInsightRun } from '@/inngest/you/insights-write';

// Longer than the model call's own timeout (CALL_TIMEOUT_MS, 285s), so a call
// that runs out is written down as a failed run before the function stops.
export const maxDuration = 300;

const bodySchema = z.object({ runId: z.string().uuid() });

/**
 * Write the insights for a queued run (plan #2413.10). Internal: called with
 * the cron secret by the Look again press and the daily cron's monthly stage.
 * Answers at once and does the one model call after the response, so neither
 * caller waits minutes for it.
 */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'name a run' }, { status: 400 });

  const { runId } = parsed.data;
  after(() =>
    pumpInsightRun({ runId }).catch((error: unknown) => {
      console.error('[insights]', runId, error instanceof Error ? error.message : error);
    }),
  );
  return NextResponse.json({ ok: true, runId }, { status: 202 });
}
