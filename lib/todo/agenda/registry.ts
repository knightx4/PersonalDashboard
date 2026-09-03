import 'server-only';

import type { AgendaSource, SourceId } from '@/lib/todo/agenda/sources';
import { jobRemindersSource } from '@/lib/todo/agenda/sources/job-reminders';

/**
 * Every source there is, in one place.
 *
 * Adding one is a file under sources/ and a line here. Nothing else changes --
 * not the page, not the merge, not the schema -- which is what the interface
 * was for.
 */
const SOURCES: AgendaSource[] = [jobRemindersSource];

export function allSources(): AgendaSource[] {
  return SOURCES;
}

export function sourceById(id: SourceId): AgendaSource | undefined {
  return SOURCES.find((source) => source.id === id);
}
