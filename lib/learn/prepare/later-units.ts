import type { Territory, TerritoryText } from '@/lib/learn/levels/territory';

/**
 * Writing the units after the opening ones from the territory (plan #2307.5).
 *
 * A prepared subject's opening units are read off its territory by the
 * write_units step. The units written as you go used to be written from the
 * subject's name and what the person knows, so the course drifted from the
 * shape the syllabi gave it. These helpers give the next-unit call the
 * territory topics no unit teaches yet, in territory order, each with the
 * weeks of the documents its lines came from, and cite the weeks a written
 * unit draws on in what it covers.
 *
 * Pure, so the tests run it without a database or a model.
 */

/** Territory topics given to one next-unit call: enough for a unit and the one after it. */
export const NEXT_TOPICS = 6;
/** Weeks named for one topic in the call. */
export const WEEKS_PER_TOPIC = 3;
/** Weeks cited on one unit. */
export const WEEKS_CITED = 3;
/** The covers line is read back at most this long (curriculum-payload's MAX_TEXT). */
const MAX_COVERS = 400;

/** A territory topic as the next-unit call reads it. */
export type LaterTopic = { name: string; scope: string; weeks: string[] };

/**
 * The document weeks a topic was put on the list by, as `<document>: <line>`.
 * A `from` line naming a text the territory does not hold is left out.
 */
export function matchedWeeks(from: readonly string[], texts: readonly TerritoryText[]): string[] {
  const labels = new Map(texts.map((t) => [t.key, t.label]));
  const weeks: string[] = [];
  for (const line of from) {
    const at = line.indexOf(': ');
    if (at < 0) continue;
    const label = labels.get(line.slice(0, at));
    if (!label) continue;
    const week = `${label}: ${line.slice(at + 2)}`;
    if (!weeks.includes(week)) weeks.push(week);
  }
  return weeks;
}

function taught(units: readonly { title: string; covers: string }[]): string {
  return units.map((u) => `${u.title} ${u.covers}`.toLowerCase()).join(' \n ');
}

/**
 * The territory topics the units so far do not name, in territory order, at
 * most `limit`. A topic is named by its drafted name (from `names`, keyed by
 * ask lower-cased) or by its ask when it has no draft, the way write_units
 * names the opening topics in what each unit covers.
 */
export function laterTopics(
  territory: Territory,
  names: ReadonlyMap<string, string>,
  units: readonly { title: string; covers: string }[],
  limit = NEXT_TOPICS,
): LaterTopic[] {
  const covered = taught(units);
  const out: LaterTopic[] = [];
  for (const topic of territory.topics) {
    if (out.length >= limit) break;
    const name = names.get(topic.ask.trim().toLowerCase()) ?? topic.ask;
    if (covered.includes(name.toLowerCase())) continue;
    out.push({ name, scope: topic.scope, weeks: matchedWeeks(topic.from, territory.texts).slice(0, WEEKS_PER_TOPIC) });
  }
  return out;
}

/** The given topics a written unit names in its title or covers. */
export function topicsTaught(unit: { title: string; covers: string }, topics: readonly LaterTopic[]): LaterTopic[] {
  const text = `${unit.title} ${unit.covers}`.toLowerCase();
  return topics.filter((t) => text.includes(t.name.toLowerCase()));
}

/**
 * The unit's covers with the weeks of the topics it teaches cited after it,
 * as "Follows <document>: <line>; …." Fewer weeks are cited where all of them
 * would make the line too long, and none when the unit names no topic.
 */
export function citeWeeks(covers: string, taughtTopics: readonly LaterTopic[]): { covers: string; weeks: string[] } {
  const all = [...new Set(taughtTopics.flatMap((t) => t.weeks))].slice(0, WEEKS_CITED);
  const base = covers.trim();
  for (let n = all.length; n > 0; n -= 1) {
    const weeks = all.slice(0, n);
    const cited = `${base} Follows ${weeks.map((w) => w.replace(/[.\s]+$/, '')).join('; ')}.`;
    if (cited.length <= MAX_COVERS) return { covers: cited, weeks };
  }
  return { covers: base, weeks: [] };
}
