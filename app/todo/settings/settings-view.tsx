import type { Feed } from '@/lib/todo/feeds/load';
import type { SourceId } from '@/lib/todo/agenda/sources';
import { allSources } from '@/lib/todo/agenda/registry';
import { MODULES, type ModuleId } from '@/lib/modules';
import { SettingsPage } from '@/components/patterns/settings-page';
import { AgendaHorizon, AgendaSources, type SourceGroup } from './view';
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
 * Todo settings on the settings page pattern (plan #1937.11), drawn from
 * what the page read (page.tsx), so the gallery can draw it from fixtures
 * (plan #1603). Three sections, so they stack.
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
    <SettingsPage
      title="Todo settings"
      href="/todo/settings"
      sections={[
        {
          id: 'sources',
          title: 'Sources',
          hint: 'Things the other workspaces already know about, shown on your agenda. They are read where they live and never copied here. Finishing one writes to the workspace that owns it.',
          content: <AgendaSources groups={groups} enabled={enabled} />,
        },
        {
          id: 'week',
          title: 'This week',
          content: <AgendaHorizon horizonDays={horizonDays} />,
        },
        {
          id: 'calendars',
          title: 'Subscribed calendars',
          hint: 'Paste the private address of a calendar you already keep and its appointments appear here beside your own. Nothing you type here is ever sent back to it.',
          content: <CalendarFeeds feeds={feeds} timezone={timezone} />,
        },
      ]}
    />
  );
}
