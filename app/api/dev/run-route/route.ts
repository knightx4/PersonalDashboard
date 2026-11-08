import { NextResponse, type NextRequest } from 'next/server';
import { handleRunRoute, RUN_ROUTE_MAX_DURATION_SECONDS } from '@/lib/dev/run-route';

export const maxDuration = RUN_ROUTE_MAX_DURATION_SECONDS;

/**
 * Run one of the app's own cron routes for a Claude Code session (plan
 * #3070.2). Authorised with the service-role key sessions already use for the
 * plan; CRON_SECRET stays on the server. See lib/dev/run-route.ts.
 *
 *   POST { path: "/api/cron/<name>", query?: {...}, askedBy?: "session:<id>",
 *          poll?: { untilField, thenQuery?, everySeconds?, maxMinutes? } }
 */
export async function POST(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // answered as a bad request by the handler, after the credential is checked
  }
  try {
    const { status, body: out } = await handleRunRoute({ authorization: request.headers.get('authorization'), body });
    return NextResponse.json(out, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
