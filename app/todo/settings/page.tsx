import Link from 'next/link';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { loadFeeds } from '@/lib/todo/feeds/load';
import { allSources } from '@/lib/todo/agenda/registry';
import { MODULES } from '@/lib/modules';
import { PageHeader } from '@/components/shell/page-header';
import { AgendaSettingsForm } from './view';
import { CalendarFeeds } from './feeds';

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

  // Grouped by the workspace they read, in the order the switcher lists them:
  // "what does the job search put on my agenda" is the question being asked,
  // and one flat list of every source in the app answers it by making you read
  // all of them.
  const groups = MODULES.flatMap((module) => {
    const sources = allSources()
      // An always-on source has no switch: each of its items was asked for
      // one at a time, where it lives.
      .filter((source) => source.module === module.id && !source.alwaysOn)
      .map((source) => ({
        id: source.id,
        label: source.label,
        description: source.description,
        // A source whose workspace is off cannot be switched on here. Turning
        // off a workspace has to mean it stops appearing, and a settings page
        // that lets you contradict that is a settings page that lies.
        available: moduleEnabled(account, module.id),
      }));
    if (sources.length === 0) return [];
    return [{ moduleId: module.id, moduleLabel: module.label, sources }];
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Todo settings"
        description="What this workspace does. Your name and timezone are under Account."
      />

      <AgendaSettingsForm
        groups={groups}
        enabled={agenda.enabledSources}
        horizonDays={agenda.horizonDays}
      />

      <div className="mt-6">
        <CalendarFeeds feeds={feeds} timezone={account.timezone} />
      </div>

      <p className="mt-6 text-ui text-ink-muted">
        Your timezone decides what counts as today here, and it holds across every workspace.{' '}
        <Link href="/account" className="font-medium text-accent hover:underline">
          Account settings
        </Link>
      </p>
    </div>
  );
}
