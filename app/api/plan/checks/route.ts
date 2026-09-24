import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { loadCommitChecks, refreshCommitChecks } from '@/lib/plan/ci';

/**
 * What CI said about the commits the closed steps shipped in.
 *
 * The plan page calls this once it has drawn, the same way round as
 * `app/api/plan/runs`. The page used to ask during its render, and when any
 * commit was due to be asked about again that meant a walk of main's history
 * and a round of comparisons before anything appeared. Now the page draws with
 * the answers already stored, and this asks GitHub, writes what came back, and
 * hands the whole set back for the rows already on screen.
 *
 * A POST because it writes. A refusal is a 200 with the reason in `error`, so
 * the page can say why CI could not be read.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = await createClient();
  const result = await refreshCommitChecks({ supabase, userId: user.id });
  // Read again only when something was written; otherwise the page already
  // has every answer there is.
  const checks = result.checked > 0 ? await loadCommitChecks(supabase, user.id) : null;

  return NextResponse.json({ checks, checked: result.checked, error: result.error });
}
