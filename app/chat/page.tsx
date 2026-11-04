import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import {
  loadPeople,
  loadThreadPage,
  searchTextOf,
  searchThreads,
  type PersonRow,
  type SearchHit,
  type ThreadPage,
} from '@/lib/you/chat-threads';
import { olderMessages, readThread } from './actions';
import { ThreadView } from './people/[key]/thread-view';
import { PeopleView } from './people-view';

export const metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

type Found = {
  rows: PersonRow[];
  hits: SearchHit[] | null;
  newest: { person: PersonRow; page: ThreadPage } | null;
  failed?: true;
};

/**
 * Chat's People tab (plan #2748.6), the page Chat opens on: everyone you
 * talk to, newest thread first, and on a laptop the newest thread open
 * beside them. `?q=` searches every thread's words.
 */
export default async function ChatPeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = searchTextOf(q);
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [found, settings] = await Promise.all([
    loadPeople(client, user.id).then(
      async (rows): Promise<Found> => {
        const first = rows.find((r) => r.chatId && r.last);
        const [hits, page] = await Promise.all([
          query ? searchThreads(client, user.id, query, rows) : null,
          first?.chatId ? loadThreadPage(client, user.id, first.chatId) : null,
        ]);
        return { rows, hits, newest: first && page ? { person: first, page } : null };
      },
      (error: unknown): Found => {
        console.error('chat people were not read', error);
        return { rows: [], hits: null, newest: null, failed: true };
      },
    ),
    loadAccountSettings(user.id),
  ]);
  const newest = found.newest;
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
