import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { allSearchSources } from '@/lib/search/registry';
import { listEverything } from '@/lib/search/search';

export const dynamic = 'force-dynamic';

/**
 * Everything the palette can find, in one answer.
 *
 * The palette fetches this once when it opens and matches it in the browser,
 * so typing costs nothing. Next door, /api/search still answers one query at a
 * time: it is what the todo link picker and the quiz picker ask, and what the
 * palette falls back to when this list did not arrive or came back capped.
 *
 * Same rules as the per-keystroke endpoint. The user comes from the session
 * and nowhere else, every read goes through a session-bound client so RLS
 * decides what is in the answer, a switched-off workspace contributes nothing,
 * and a workspace that falls over costs only itself.
 *
 * No caching, and no revalidation window: this answer is one account's own
 * rows, and a cached copy would show a note somebody just deleted.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const settings = await loadAccountSettings(user.id);

  const { hits, failed, truncated } = await listEverything({
    userId: user.id,
    sources: allSearchSources(),
    enabledModules: settings.enabledModules,
  });

  // A source that fell over is a log line, not something for the box: the
  // palette's promise is that the rest still answers.
  if (failed.length > 0) {
    console.error(`[search] no answer from ${failed.join(', ')}`);
  }

  return NextResponse.json({ hits, truncated }, { headers: { 'cache-control': 'no-store' } });
}
