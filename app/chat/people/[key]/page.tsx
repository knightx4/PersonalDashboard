import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadPeople, loadThreadPage, type ThreadPage } from '@/lib/you/chat-threads';
import { loadPersonCard } from '@/lib/you/people-cards';
import { correctPersonMemory, draftPersonCard, olderMessages, readThread, removePersonMemory, retryReply, savePersonCard } from '../../actions';
import { PeopleView } from '../../people-view';
import { PersonForm } from '../person-form';
import { ThreadView } from './thread-view';

export const metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

const KEY = /^[a-z0-9_-]{1,80}$/;

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * One thread on Chat's People tab (plan #2748.6): the list beside it on a
 * laptop, the thread alone on a phone. It opens on the newest fifty messages;
 * the view pages back from there. `?edit=1` opens the form for editing them
 * in the thread's place (plan #2748.11).
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
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [rows, settings] = await Promise.all([loadPeople(client, user.id), loadAccountSettings(user.id)]);
  const person = rows.find((r) => r.key === key);
  if (!person) notFound();
  if (edit === '1') {
    const card = await loadPersonCard(client, user.id, key);
    if (!card) notFound();
    return (
      <PeopleView rows={rows} current={key} timezone={settings.timezone} now={now}>
        <PersonForm
          key={`${card.id}-${card.persona.length}`}
          card={card}
          timezone={settings.timezone}
          now={now}
          actions={{ save: savePersonCard, draft: draftPersonCard, correct: correctPersonMemory, remove: removePersonMemory }}
        />
      </PeopleView>
    );
  }
  const page: ThreadPage = person.chatId
    ? await loadThreadPage(client, user.id, person.chatId)
    : { messages: [], hasOlder: false };
  return (
    <PeopleView rows={rows} current={key} timezone={settings.timezone} now={now}>
      <ThreadView
        key={person.id}
        person={person}
        chatId={person.chatId}
        page={page}
        typingUntil={person.typingUntil}
        timezone={settings.timezone}
        now={now}
        actions={{ older: olderMessages, read: readThread, retryReply }}
      />
    </PeopleView>
  );
}
