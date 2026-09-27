import { parseEventRef } from './observations';
import { eventRef, TIMELINE_MODULES, type TimelineEvent, type TimelineModule } from './timeline';

/**
 * The weekly observations as the home page and the timeline show them (plan
 * #1120): each stored row with the timeline events its evidence names, found
 * again by ref. Pure, so the reads in observations-load.ts and the tests
 * share one set of rules.
 */

/** One row of core.observations, as the pages read it. */
export type ObservationRecord = {
  id: string;
  week: string;
  position: number;
  sentence: string;
  evidence: string[];
  modules: string[];
  verdict: 'useful' | 'not_useful' | null;
};

/** The columns read from core.observations. */
export const OBSERVATION_COLUMNS = 'id, week, position, sentence, evidence, modules, verdict';

/** An observation with the rows behind it, newest first. */
export type ShownObservation = {
  id: string;
  week: string;
  sentence: string;
  modules: TimelineModule[];
  /** The evidence that is still on the timeline; a row deleted since is left out. */
  events: TimelineEvent[];
};

/**
 * The refs to look up, grouped by the table they sit in, so each read is one
 * `source_table = … and source_id in (…)`. Refs that are not refs are skipped.
 */
export function evidenceByTable(records: readonly ObservationRecord[]): Map<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const record of records) {
    for (const ref of record.evidence) {
      const parsed = parseEventRef(ref);
      if (!parsed) continue;
      const ids = byTable.get(parsed.sourceTable) ?? new Set<string>();
      ids.add(parsed.sourceId);
      byTable.set(parsed.sourceTable, ids);
    }
  }
  return new Map([...byTable].map(([table, ids]) => [table, [...ids]]));
}

/**
 * The observations to show: marked not useful ones left out for good, the
 * rest in week order (newest first) then the order the run gave them, each
 * with its evidence events found among `events`, newest first.
 */
export function showObservations(
  records: readonly ObservationRecord[],
  events: readonly TimelineEvent[],
): ShownObservation[] {
  const byRef = new Map(events.map((event) => [eventRef(event), event]));
  return records
    .filter((record) => record.verdict !== 'not_useful')
    .sort((a, b) => b.week.localeCompare(a.week) || a.position - b.position)
    .map((record) => ({
      id: record.id,
      week: record.week,
      sentence: record.sentence,
      modules: TIMELINE_MODULES.filter((module) => record.modules.includes(module)),
      events: [...new Set(record.evidence)]
        .map((ref) => byRef.get(ref))
        .filter((event): event is TimelineEvent => event !== undefined)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    }));
}

/** "Week of 21 September", for a week's Monday. */
export function weekLabel(week: string): string {
  return `Week of ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${week}T00:00:00Z`),
  )}`;
}
