import 'server-only';

import type { AgendaSource, SourceId } from '@/lib/todo/agenda/sources';

/**
 * Every source there is, in one place.
 *
 * Empty on purpose in this step. The interface and the wiring around it are
 * what needed deciding; a scaffold with nothing plugged into it sounds like a
 * step to skip, and it is the step that decides whether the next two are one
 * file each or a rewrite.
 */
const SOURCES: AgendaSource[] = [];

export function allSources(): AgendaSource[] {
  return SOURCES;
}

export function sourceById(id: SourceId): AgendaSource | undefined {
  return SOURCES.find((source) => source.id === id);
}
