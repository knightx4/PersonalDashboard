import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { pumpPreparation } from '@/inngest/learn/prepare';

// Longer than PREPARE_BUDGET_MS (240s), so the hand-off at the end of a call
// is made before the function is stopped. lib/learn/prepare/run.test.ts checks it.
export const maxDuration = 300;

const bodySchema = z.object({ subjectId: z.string().uuid() });

/**
 * Work a subject's preparation run (plan #2276.1). Internal: called with the
 * cron secret by the press that made the subject, by the daily cron, and by
 * itself when a call runs out of time. Answers at once and works the run
 * after the response, so the caller never waits for it.
 */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'name a subject' }, { status: 400 });

  const origin = requestOrigin(request);
  const { subjectId } = parsed.data;
  after(() =>
    pumpPreparation({ subjectId, origin }).catch((error: unknown) => {
      console.error('[learn prepare]', subjectId, error instanceof Error ? error.message : error);
    }),
  );
  return NextResponse.json({ ok: true, subjectId }, { status: 202 });
}
