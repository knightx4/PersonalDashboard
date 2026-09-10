import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { allSearchSources } from '@/lib/search/registry';
import { searchEverything } from '@/lib/search/search';
import { MIN_QUERY } from '@/lib/search/sources';
import { LINKABLE_HIT_KINDS } from '@/lib/todo/links/from-hit';

export const dynamic = 'force-dynamic';

/**
 * What the palette asks.
 *
 * A route handler rather than a server action, which is the one interesting
 * decision here: the palette fires on keystrokes and has to abort whatever is
 * still in flight when the next one arrives. A server action cannot be
 * aborted, so a slow answer to "ac" would land after the answer to "acme" and
 * quietly replace it with staler results.
 *
 * The user comes from the session and nowhere else. Nothing in the query
 * string names an account, and the sources each read through their own
 * session-bound client, so RLS decides what any of this can see.
 *
 * No caching. A search over your own rows is as fresh as the rows, and a
 * cached one would show a thing you just deleted.
 *
 * `?for=link` narrows the answer to what a task can be about, for the todo
 * link picker. A named audience rather than a list of kinds in the query
 * string: the browser says what it is for and the server decides what that
 * means, so the one list of linkable kinds stays in one place.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim() ?? '';
  if (query.length < MIN_QUERY) {
    return NextResponse.json({ hits: [] }, { headers: { 'cache-control': 'no-store' } });
  }

  const settings = await loadAccountSettings(user.id);

  const { hits, failed } = await searchEverything({
    userId: user.id,
    query,
    sources: allSearchSources(),
    enabledModules: settings.enabledModules,
    kinds: params.get('for') === 'link' ? LINKABLE_HIT_KINDS : undefined,
  });

  // A source that fell over is a log line, not something for the box: the
  // palette's promise is that the rest still answers.
  if (failed.length > 0) {
    console.error(`[search] no answer from ${failed.join(', ')}`);
  }

  return NextResponse.json({ hits }, { headers: { 'cache-control': 'no-store' } });
}
