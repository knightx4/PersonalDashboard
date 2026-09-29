import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runJevTrial } from '@/inngest/jobs/cron/jev-trial';
import { isJobEmailLabel } from '@/lib/jobs/email/jev-question';

// The trial stops itself at 240 seconds; this leaves room to write the rest.
export const maxDuration = 300;

/**
 * The Jev pilot on job email (plan #1165), on demand. Not scheduled: it is
 * called until `remaining` is 0, and the last call returns the summary the
 * write-up in docs/trials/ is read from. `?user=` is required: the trial sends
 * mail text to TypeSafe, and only the account that agreed to that (#1163) is
 * run. `?limit=` caps the messages per call. `?trial=` names a new trial,
 * whose answers are kept apart from the first one's, and `?labels=` takes a
 * comma-separated list of stored labels to narrow it to: the re-run after
 * #1166 reworded two options is
 * `?user=…&trial=job-email-2026-09-reworded&labels=interview_invite,scheduling`.
 * POST as well as GET, because pg_net posts.
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = request.nextUrl.searchParams.get('user');
  if (!userId) {
    return NextResponse.json({ error: 'user is required' }, { status: 400 });
  }
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
  const trial = request.nextUrl.searchParams.get('trial')?.trim() || undefined;
  const labels = request.nextUrl.searchParams
    .get('labels')
    ?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  if (labels?.some((label) => !isJobEmailLabel(label))) {
    return NextResponse.json({ error: 'labels must be job-email classifications' }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, results: await runJevTrial({ userId, limit, trial, labels }) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
