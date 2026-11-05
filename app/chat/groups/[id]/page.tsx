import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadPeople, withChats } from '@/lib/you/chat-threads';
import { loadGroup, loadGroupRows, loadGroupThreadPage } from '@/lib/you/group-chats';
import { deleteGroupChat, olderGroupMessages, readGroup, saveGroup } from '../../actions';
import { PeopleView } from '../../people-view';
import { GroupSettings } from './group-settings';
import { GroupThreadView } from './group-thread-view';

export const metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * A group chat on Chat's Messages tab (plan #2879.1.3): the list beside it
 * on a laptop, the group alone on a phone. `?settings=1` opens its settings
 * in the thread's place: rename, members, delete.
 */
export default async function ChatGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ settings?: string }>;
}) {
  const [{ id }, { settings: settingsParam }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [group, everyone, groups, settings] = await Promise.all([
    loadGroup(client, user.id, id),
    loadPeople(client, user.id),
    loadGroupRows(client, user.id),
    loadAccountSettings(user.id),
  ]);
  if (!group) notFound();
  const rows = withChats(everyone);
  if (settingsParam === '1') {
    return (
      <PeopleView rows={rows} groups={groups} current={id} timezone={settings.timezone} now={now}>
        <GroupSettings
          chatId={id}
          name={group.name ?? ''}
          members={group.members}
          everyone={everyone}
          actions={{ save: saveGroup, remove: deleteGroupChat }}
        />
      </PeopleView>
    );
  }
  const page = await loadGroupThreadPage(client, user.id, id);
  return (
    <PeopleView rows={rows} groups={groups} current={id} timezone={settings.timezone} now={now}>
      <GroupThreadView
        key={id}
        chatId={id}
        title={group.title}
        members={group.members}
        former={group.former}
        page={page}
        timezone={settings.timezone}
        now={now}
        actions={{ older: olderGroupMessages, read: readGroup }}
      />
    </PeopleView>
  );
}
