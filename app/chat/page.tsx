import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import {
  loadPeople,
  loadThreadPage,
  searchTextOf,
  searchThreads,
  withChats,
  type PersonRow,
  type SearchHit,
  type ThreadPage,
} from '@/lib/you/chat-threads';
import { olderMessages, readThread, startChatWith } from './actions';
import { NewMessage } from './new-message';
import { ThreadView } from './people/[key]/thread-view';
import { PeopleView } from './people-view';

export const metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

type Found = {
  /** Everyone on the roster, for New message. */
  everyone: PersonRow[];
  /** Those with a chat, which the list shows. */
  rows: PersonRow[];
  hits: SearchHit[] | null;
  newest: { person: PersonRow; page: ThreadPage } | null;
  failed?: true;
};

/**
 * Chat's Messages tab (plan #2748.6, #2879.2), the page Chat opens on: the
 * people and bots you have a chat with, newest first, and on a laptop the
 * newest thread open beside them. `?q=` searches every thread's words,
 * and `?new=1` opens New message in the thread's place. Adding a bot is on
 * the Bots tab (plan #2879.3).
 */
export default async function ChatMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; new?: string }>;
}) {
  const params = await searchParams;
  const composing = params.new === '1';
  const query = searchTextOf(params.q);
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [found, settings] = await Promise.all([
    loadPeople(client, user.id).then(
      async (everyone): Promise<Found> => {
        const rows = withChats(everyone);
        const first = rows.find((r) => r.chatId && r.last);
        const [hits, page] = await Promise.all([
          query ? searchThreads(client, user.id, query, rows) : null,
          first?.chatId ? loadThreadPage(client, user.id, first.chatId) : null,
        ]);
        return { everyone, rows, hits, newest: first && page ? { person: first, page } : null };
      },
      (error: unknown): Found => {
        console.error('chat people were not read', error);
        return { everyone: [], rows: [], hits: null, newest: null, failed: true };
      },
    ),
    loadAccountSettings(user.id),
  ]);
  const newest = found.newest;
  if (composing && !found.failed) {
    return (
      <PeopleView rows={found.rows} query={query} hits={found.hits} timezone={settings.timezone} now={now} adding>
        <NewMessage everyone={found.everyone} start={startChatWith} />
      </PeopleView>
    );
  }
  return (
    <PeopleView
      rows={found.rows}
      failed={found.failed}
      query={query}
      hits={found.hits}
      current={newest?.person.key ?? null}
      newest
      timezone={settings.timezone}
      now={now}
    >
      {newest && (
        <ThreadView
          key={newest.person.id}
          person={newest.person}
          chatId={newest.person.chatId}
          page={newest.page}
          typingUntil={newest.person.typingUntil}
          timezone={settings.timezone}
          now={now}
          actions={{ older: olderMessages, read: readThread }}
        />
      )}
    </PeopleView>
  );
}
