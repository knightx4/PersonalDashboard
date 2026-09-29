import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runJevTrial } from '@/inngest/jobs/cron/jev-trial';

// The trial stops itself at 240 seconds; this leaves room to write the rest.
export const maxDuration = 300;

/**
 * The Jev pilot on job email (plan #1165), on demand. Not scheduled: it is
 * called until `remaining` is 0, and the last call returns the summary the
 * write-up in docs/trials/ is read from. `?limit=` caps the messages per call.
 * POST as well as GET, because pg_net posts.
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
  try {
    return NextResponse.json({ ok: true, results: await runJevTrial({ limit }) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
