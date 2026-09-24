import 'server-only';

import { moduleEnabled, type AccountSettings } from '@/lib/core/account/settings';
import type { AgendaSource, SourceId } from '@/lib/todo/agenda/sources';
import { goalStepsSource } from '@/lib/todo/agenda/sources/goal-steps';
import { jobInterviewsSource } from '@/lib/todo/agenda/sources/job-interviews';
import { jobRemindersSource } from '@/lib/todo/agenda/sources/job-reminders';
import { returnDeadlinesSource } from '@/lib/todo/agenda/sources/return-deadlines';

/**
 * Every source there is, in one place.
 *
 * Adding one is a file under sources/ and a line here. Nothing else changes --
 * not the page, not the merge, not the schema -- which is what the interface
 * was for.
 */
const SOURCES: AgendaSource[] = [
  jobRemindersSource,
  jobInterviewsSource,
  returnDeadlinesSource,
  goalStepsSource,
];

export function allSources(): AgendaSource[] {
  return SOURCES;
}

export function sourceById(id: SourceId): AgendaSource | undefined {
  return SOURCES.find((source) => source.id === id);
}

/**
 * The sources that run for this account: switched on here, or always on, and
 * never one whose workspace is off. Turning off a workspace has to mean it
 * stops appearing, whatever this module's own settings say.
 */
export function activeSources(account: AccountSettings, enabled: SourceId[]): AgendaSource[] {
  return SOURCES.filter(
    (source) =>
      (source.alwaysOn || enabled.includes(source.id)) && moduleEnabled(account, source.module),
  );
}
