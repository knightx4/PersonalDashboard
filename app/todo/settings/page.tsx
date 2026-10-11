import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { loadFeeds } from '@/lib/todo/feeds/load';
import { agendaSourceGroups, TodoSettingsView } from './settings-view';

export const metadata = { title: 'Todo settings' };

/**
 * This workspace's own settings: what feeds the agenda, and how far it looks.
 *
 * Both would be meaningless with the module switched off, which is the test for
 * what belongs here rather than under Account. Your name, timezone and currency
 * are one link away and are not repeated.
 */
export default async function TodoSettingsPage() {
  const user = await requireUser();
  const [account, agenda, feeds] = await Promise.all([
    loadAccountSettings(user.id),
    loadAgendaSettings(user.id),
    loadFeeds(user.id),
  ]);

  const groups = agendaSourceGroups((moduleId) => moduleEnabled(account, moduleId));

  return (
    <TodoSettingsView
      groups={groups}
      enabled={agenda.enabledSources}
      horizonDays={agenda.horizonDays}
      feeds={feeds}
      timezone={account.timezone}
    />
  );
}
