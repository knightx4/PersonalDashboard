import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { speechReportLine } from '@/lib/talk/speech/report-line';

/**
 * Why a reply was not heard in the browser (plan #3068), written to the
 * server log as one `[speech] not heard` line: the stage, the route's status,
 * the error's name, the audio context's state and the browser. Nothing is
 * stored; the line is read in the deployment's runtime logs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Send the report as JSON.' }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  const line = speechReportLine(body, request.headers.get('user-agent'));
  if (!line) return NextResponse.json({ error: 'Send the report as an object.' }, { status: 400 });
  console.warn('[speech] not heard', JSON.stringify({ user: user.id, ...line }));
  return new Response(null, { status: 204 });
}
