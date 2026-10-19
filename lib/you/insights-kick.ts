import 'server-only';

import { after } from 'next/server';
import { requestOrigin } from '@/lib/auth/origin';
import { publicEnv } from '@/lib/env';

/**
 * Start an insights run's single model call in a function of its own
 * (plan #2413.10). The call can take minutes, so it never runs inside the
 * press or the daily cron: /api/cron/you-insights answers at once and does
 * the work after the response, as the Learn preparation route does
 * (lib/learn/prepare/kick.ts). The run row is queued first, so the tab shows
 * it running at once, and a kick that never lands is failed by the caller.
 */

export const INSIGHTS_ROUTE = '/api/cron/you-insights';

function secret(): string | null {
  return process.env.CRON_SECRET?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim() || null;
}

/** Ask the route to work the run. False when it could not be reached. */
export async function kickInsightRun(origin: string, runId: string): Promise<boolean> {
  const token = secret();
  if (!token) {
    console.error('[insights] no CRON_SECRET, so the run cannot be started');
    return false;
  }
  try {
    const res = await fetch(`${origin}${INSIGHTS_ROUTE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) console.error('[insights] kick refused', res.status);
    return res.ok;
  } catch (error) {
    console.error('[insights] kick failed', error instanceof Error ? error.message : error);
    return false;
  }
}

/** Start the run once the response has gone; `onFail` runs when the route could not be reached. */
export function kickInsightRunAfterResponse(runId: string, onFail: () => Promise<void>): void {
  after(async () => {
    const origin = await requestOrigin().catch(() => publicEnv().NEXT_PUBLIC_APP_URL);
    if (!(await kickInsightRun(origin, runId))) await onFail();
  });
}
