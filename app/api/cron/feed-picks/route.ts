import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runFeedPicks } from '@/inngest/learn/feed-picks';

// A call picks for FEED_PICKS_BUDGET_MS (just under four minutes) and then
// stops, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * The Learn now picking pass (docs/LEARN-NOW-SPEC.md, "How cards are made",
 * steps 1 to 3; plan #806).
 *
 * Draws a few targets for every account with placed themes, names Wikipedia
 * sections for each, stores the articles in the catalogue and leaves `picked`
 * rows in learn.feed_cards. The hourly top-up (`/api/cron/feed-top-up`, plan
 * #807) runs the same pass per person when it needs more picks, so this route
 * is for a manual run across every account.
 *
 * `?targets=n` draws n targets per person instead of the default four, up to
 * ten. Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because every call spends model budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const asked = Number(request.nextUrl.searchParams.get('targets'));
  const targets = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 10) : undefined;
  try {
    return NextResponse.json({ ok: true, ...(await runFeedPicks({ targets })) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
