import 'server-only';

import { after } from 'next/server';
import { requestOrigin } from '@/lib/auth/origin';
import { publicEnv } from '@/lib/env';

/**
 * Start or continue a subject's preparation in a function of its own
 * (plan #2276.1).
 *
 * The work runs behind /api/cron/learn-prepare, which answers at once and works the
 * run for up to four minutes with the service role, then calls itself again
 * until the run is done. So the press that made the subject never waits for
 * it, and a run outlives the request that started it.
 */

export const PREPARE_ROUTE = '/api/cron/learn-prepare';

function secret(): string | null {
  return process.env.CRON_SECRET?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim() || null;
}

/**
 * Ask the route to work the run. False when it could not be reached; the
 * daily cron picks the run up then. `branch` names a branch run by its key
 * (plan #2276.7); without one it is the subject's own run.
 */
export async function kickPreparation(origin: string, subjectId: string, branch: string | null = null): Promise<boolean> {
  const token = secret();
  if (!token) {
    console.error('[learn prepare] no CRON_SECRET, so the run waits for the daily cron');
    return false;
  }
  try {
    const res = await fetch(`${origin}${PREPARE_ROUTE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(branch ? { subjectId, branch } : { subjectId }),
    });
    if (!res.ok) console.error('[learn prepare] kick refused', res.status);
    return res.ok;
  } catch (error) {
    console.error('[learn prepare] kick failed', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Start the subject's preparation once the response has gone. The run's rows
 * already exist (the trigger in 0167 opened them with the subject), so a kick
 * that never happens loses nothing: the daily cron starts the run instead.
 * Safe to call outside a request, where it does nothing.
 */
export function prepareSubjectAfterResponse(subjectId: string): void {
  try {
    after(async () => {
      const origin = await requestOrigin().catch(() => publicEnv().NEXT_PUBLIC_APP_URL);
      await kickPreparation(origin, subjectId);
    });
  } catch (error) {
    console.error('[learn prepare] not in a request; left for the daily cron', error instanceof Error ? error.message : error);
  }
}
