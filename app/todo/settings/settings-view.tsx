import Link from 'next/link';
import type { Feed } from '@/lib/todo/feeds/load';
import type { SourceId } from '@/lib/todo/agenda/sources';
import { allSources } from '@/lib/todo/agenda/registry';
import { MODULES, type ModuleId } from '@/lib/modules';
import { PageHeader } from '@/components/shell/page-header';
import { AgendaSettingsForm, type SourceGroup } from './view';
import { CalendarFeeds } from './feeds';

/**
 * The agenda's sources, grouped by the workspace they read. `isOn` says
 * whether a workspace is switched on in Account.
 */
export function agendaSourceGroups(isOn: (moduleId: ModuleId) => boolean): SourceGroup[] {
  // Grouped by the workspace they read, in the order the switcher lists them:
  // "what does the job search put on my agenda" is the question being asked,
  // and one flat list of every source in the app answers it by making you read
  // all of them.
  return MODULES.flatMap((module) => {
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
        available: isOn(module.id),
      }));
    if (sources.length === 0) return [];
    return [{ moduleId: module.id, moduleLabel: module.label, sources }];
  });
}

/**
 * Todo settings, drawn from what the page read (page.tsx), so the gallery
 * can draw it from fixtures (plan #1603).
 */
export function TodoSettingsView({
  groups,
  enabled,
  horizonDays,
  feeds,
  timezone,
}: {
  groups: SourceGroup[];
  enabled: SourceId[];
  horizonDays: number;
  feeds: Feed[];
  timezone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Todo settings"
        description="What this workspace does. Your name and timezone are under Account."
      />

      <AgendaSettingsForm
        groups={groups}
        enabled={enabled}
        horizonDays={horizonDays}
      />

      <div className="mt-6">
        <CalendarFeeds feeds={feeds} timezone={timezone} />
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
