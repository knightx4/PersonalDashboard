import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadPeople, loadThreadPage, withChats, type ThreadPage } from '@/lib/you/chat-threads';
import { loadGroupRows } from '@/lib/you/group-chats';
import { editHref } from '@/lib/you/people-cards-model';
import { olderMessages, readThread } from '../../actions';
import { PeopleView } from '../../people-view';
import { ThreadView } from './thread-view';

export const metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

const KEY = /^[a-z0-9_-]{1,80}$/;

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * One thread on Chat's Messages tab (plan #2748.6): the list beside it on a
 * laptop, the thread alone on a phone. It opens on the newest fifty messages;
 * the view pages back from there. Their form is on the Bots tab now (plan
 * #2879.3), so the old `?edit=1` goes there.
 */
export default async function ChatThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ key }, { edit }] = await Promise.all([params, searchParams]);
  if (!KEY.test(key)) notFound();
  if (edit === '1') redirect(editHref(key));
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [everyone, groups, settings] = await Promise.all([loadPeople(client, user.id), loadGroupRows(client, user.id), loadAccountSettings(user.id)]);
  // The list beside it holds only the chats there are (plan #2879.2), and this thread's row; the thread opens for anyone on the roster.
  const rows = withChats(everyone, key);
  const person = everyone.find((r) => r.key === key);
  if (!person) notFound();
  const page: ThreadPage = person.chatId
    ? await loadThreadPage(client, user.id, person.chatId)
    : { messages: [], hasOlder: false };
  return (
    <PeopleView rows={rows} groups={groups} current={key} timezone={settings.timezone} now={now}>
      <ThreadView
        key={person.id}
        person={person}
        chatId={person.chatId}
        page={page}
        typingUntil={person.typingUntil}
        timezone={settings.timezone}
        now={now}
        actions={{ older: olderMessages, read: readThread }}
      />
    </PeopleView>
  );
}
