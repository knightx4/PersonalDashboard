import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { allSearchSources } from '@/lib/search/registry';
import { parseScope, SCOPE_PARAM } from '@/lib/search/scope';
import { searchEverything } from '@/lib/search/search';
import { MIN_QUERY, type HitKind } from '@/lib/search/sources';
import { QUIZ_HIT_KINDS } from '@/lib/learn/quiz/model';
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
 * `?in=` narrows the answer to one workspace, and is what the search bar at
 * the top of a workspace sends. Left out, or naming a workspace this app does
 * not have, the answer covers everything you own, which is what the command
 * box asks for.
 *
 * `?for=` narrows the answer to what one caller can use: `link` is what a task
 * can be about, for the todo link picker, and `quiz` is what a quiz can be
 * written from. A named audience rather than a list of kinds in the query
 * string: the browser says what it is for and the server decides what that
 * means, so each list of kinds stays in the one place that owns it.
 */

/** What each audience is allowed to see. Anything else gets the whole palette. */
const FOR: Record<string, readonly HitKind[]> = {
  link: LINKABLE_HIT_KINDS,
  quiz: QUIZ_HIT_KINDS,
};
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
    scope: parseScope(params.get(SCOPE_PARAM)),
    kinds: FOR[params.get('for') ?? ''],
  });

  // A source that fell over is a log line, not something for the box: the
  // palette's promise is that the rest still answers.
  if (failed.length > 0) {
    console.error(`[search] no answer from ${failed.join(', ')}`);
  }

  return NextResponse.json({ hits }, { headers: { 'cache-control': 'no-store' } });
}
