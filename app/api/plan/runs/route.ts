import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { refreshRunReadings } from '@/lib/plan/runs';

/**
 * What GitHub says about the runs behind the steps that are being worked.
 *
 * The plan page calls this once it has drawn. #563 settled it this way round:
 * asking GitHub while the page renders would put a network request in front of
 * every open of /dev/plan, and asking from the browser and keeping the answer
 * there would leave the terminal tool and a session's brief on the two-hour
 * clock. So the request happens here, the answer is written onto the run rows,
 * and every surface reads the same stored reading -- the page a moment after it
 * appears, the others whenever they next read a run.
 *
 * A POST because it writes. The user comes from the session and nothing in the
 * request names one; there is no body at all, since what to ask about is every
 * run behind a claimed step of theirs.
 *
 * A refusal is a 200 with the reason in `error`, not a failure: GitHub having
 * refused is the answer, it is written to `github_error` on the runs it was
 * asked about, and the page has the reading it drew with either way.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = await createClient();
  const result = await refreshRunReadings({ supabase, userId: user.id });

  return NextResponse.json({
    readings: result.readings,
    written: result.written,
    error: result.error,
  });
}
