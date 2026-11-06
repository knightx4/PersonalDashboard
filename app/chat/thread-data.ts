import 'server-only';
import { createClient } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadBuildRuns } from '@/lib/talk/build-runs';
import { loadPeopleChanges, type DashChange } from '@/lib/talk/changes';
import { buildRunId, type BuildRun } from '@/lib/you/live-cards';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { withMessageFiles } from '@/lib/you/chat-message-files';
import { withWatches } from '@/lib/you/watch-decide';
import { loadThreadPage, type ThreadPage } from '@/lib/you/chat-threads';

/**
 * What a direct thread is drawn from, on its page on the Messages tab and in
 * the Ask Dash pane (plan #2981): the newest page of messages with their
 * files, the cards for what the bot did in it, and where its builds stand.
 * Each part past the messages falls back to nothing when it cannot be read,
 * and the thread reads it again when a reply comes in.
 */
export async function loadThreadParts(
  client: YouSupabaseClient,
  userId: string,
  chatId: string | null,
): Promise<{ page: ThreadPage; changes: DashChange[]; builds: Record<string, BuildRun> }> {
  if (!chatId) return { page: { messages: [], hasOlder: false }, changes: [], builds: {} };
  const [page, changes]: [ThreadPage, DashChange[]] = await Promise.all([
    // The files sent with each message (plan #2974); the thread still opens without them.
    loadThreadPage(client, userId, chatId).then(async (found) => ({
      ...found,
      messages: await createCoreClient()
        .then((core) => withMessageFiles(core, found.messages))
        .catch((error: unknown) => {
          console.error('thread files not read', error);
          return found.messages;
        }),
    })),
    // The thread still opens when its cards cannot be read; a reply re-reads them.
    createCoreClient()
      .then((core) => loadPeopleChanges(core, chatId))
      // A watch Dash wrote is drawn as it is now, with Approve and Decline while proposed (plan #3030.1.2).
      .then((changes) => withWatches(client, changes))
      .catch((error: unknown) => {
        console.error('thread changes not read', error);
        return [];
      }),
  ]);
  // Where the builds confirmed here stand (plan #2854.3); the thread reads them again when it cannot.
  const runIds = changes.flatMap((change) => buildRunId(change) ?? []);
  const builds: Record<string, BuildRun> =
    runIds.length > 0
      ? await Promise.all([createClient(), createCoreClient()])
          .then(([db, core]) => loadBuildRuns(db, core, runIds))
          .catch((error: unknown) => {
            console.error('thread builds not read', error);
            return {};
          })
      : {};
  return { page, changes, builds };
}
