import type { GoalKind, GoalToClassify } from '@/lib/learn/goal-kind';
import { numbered, type DraftSource, type DraftSources } from '@/lib/learn/levels/draft-sources';

/**
 * A territory: a list of topics drafted together from one set of sources
 * (plan #2172.6). Pure. The drafter in territory-run.ts goes down `topics`,
 * compiling each from the same sources and performances with the call from
 * plan #2138.11, so every topic arrives with its five checks and the overlap
 * between its two drafts, and waits as a draft for the person to approve.
 */

export type TerritoryText = {
  /** Short name a topic's `from` lines use, such as `skok`. */
  key: string;
  label: string;
  items: string[];
  /** The stored document the lines were read from, for a territory compiled from the bank (plan #2276.4). */
  itemId?: string;
  url?: string;
  /** Documents with one key count once towards canonicality: two terms of one course are one view. */
  independence?: string;
};

/**
 * How widely a topic is taught (docs/LEARN-LEVELS-SPEC.md): canonical in two
 * or more independent documents, practitioner in one, personal in none.
 */
export const TERRITORY_CANONICALITIES = ['canonical', 'practitioner', 'personal'] as const;
export type TerritoryCanonicality = (typeof TERRITORY_CANONICALITIES)[number];

export type TerritoryTopic = {
  /** What the drafting call is asked for; also how a drafted topic is found again (`topics.asked`). */
  ask: string;
  scope: string;
  /** Title of the Level 4 frame article in learn.area_check_articles this topic refines. */
  frame: string;
  /** Target level on the subject's lens. */
  target: number;
  /** The source lines that put it on the list, as `<text key>: <line>`. */
  from: string[];
  /** The area it belongs to, one of the territory's `areas`; absent in a territory with no areas. */
  area?: string;
  /** Set by the count of independent documents its lines come from; absent on a hand-written territory. */
  canonicality?: TerritoryCanonicality;
};

export type Territory = {
  key: string;
  name: string;
  /** Name of the subject lens the topics join; the goal lens takes them in through learn 0137. */
  subjectLens: string;
  performances: string[];
  /**
   * Optional areas the topics are grouped into, such as `accounting`, so a
   * pack can be drafted one area at a time (plan #2483.1). Each topic names
   * its area in `area`. A territory with no areas drafts as one.
   */
  areas?: string[];
  /** Phrases naming roles in job_search whose requirement lines join the sources. */
  roles: string[];
  texts: TerritoryText[];
  topics: TerritoryTopic[];
  /**
   * The goal the stored documents are searched and pulled for (plan
   * #2247.10), as the learn aim words it; the territory's name when absent.
   */
  goal?: GoalToClassify;
  /** The goal's kind, which decides the providers a first draft pulls from; none pulls nothing. */
  kind?: GoalKind | null;
};

/**
 * The sources as the drafting call reads them: the roles first, then the
 * texts in order, numbered S1 onwards. A role phrase that matched nothing is
 * left out.
 */
export function territorySources(
  territory: Territory,
  roleSources: readonly (Omit<DraftSource, 'id'> | null)[],
): DraftSources {
  const roles = roleSources.filter((s): s is Omit<DraftSource, 'id'> => s !== null);
  const texts = territory.texts.map((t) => ({ label: t.label, items: t.items }));
  return { sources: numbered([...roles, ...texts]), performances: territory.performances };
}

/** `from` lines that name no line of the territory's texts, so a typo cannot pass as a citation. */
export function unsourcedFrom(territory: Territory): string[] {
  const lines = new Set(territory.texts.flatMap((t) => t.items.map((i) => `${t.key}: ${i}`)));
  return territory.topics.flatMap((t) => t.from.filter((f) => !lines.has(f)));
}

/**
 * The topics still to draft, in order: those whose ask is not yet on any
 * topic. Given an area, only that area's topics (plan #2483.1).
 */
export function topicsLeft(territory: Territory, asked: readonly (string | null)[], area?: string): TerritoryTopic[] {
  const done = new Set(asked.filter((a): a is string => a !== null).map((a) => a.trim().toLowerCase()));
  return territory.topics.filter((t) => !done.has(t.ask.trim().toLowerCase()) && (area === undefined || t.area === area));
}

/** Why an area cannot be drafted from this territory, or null when it can. */
export function areaProblem(territory: Territory, area: string): string | null {
  if (!territory.areas || territory.areas.length === 0) return `territory "${territory.key}" has no areas`;
  if (!territory.areas.includes(area)) return `no area "${area}" in "${territory.key}"; areas are ${territory.areas.join(', ')}`;
  return null;
}

/** Topics that name an area the territory does not declare, or none when it declares areas. */
export function strayAreas(territory: Territory): string[] {
  const areas = territory.areas ?? [];
  return territory.topics.filter((t) => (areas.length === 0 ? t.area !== undefined : !t.area || !areas.includes(t.area))).map((t) => t.ask);
}

/**
 * A topic's canonicality from the texts its lines come from: two or more
 * independent documents is canonical, one is practitioner, none is personal.
 * A text with no independence key is its own document.
 */
export function canonicalityFrom(from: readonly string[], texts: readonly TerritoryText[]): TerritoryCanonicality {
  const keyOf = new Map(texts.map((t) => [t.key, t.independence ?? `text:${t.key}`]));
  const independent = new Set(
    from.flatMap((line) => {
      const key = keyOf.get(line.slice(0, line.indexOf(':')));
      return key ? [key] : [];
    }),
  );
  if (independent.size >= 2) return 'canonical';
  if (independent.size === 1) return 'practitioner';
  return 'personal';
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/**
 * A territory read back from jsonb (learn.subject_preparations.territory), or
 * null when it is not one. Only the shape is checked; a stored territory was
 * held to unsourcedFrom before it was written.
 */
export function readTerritory(value: unknown): Territory | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Record<string, unknown>;
  if (typeof t.key !== 'string' || typeof t.name !== 'string' || typeof t.subjectLens !== 'string') return null;
  if (!isStrings(t.performances) || !isStrings(t.roles) || !Array.isArray(t.texts) || !Array.isArray(t.topics)) return null;
  const textsOk = t.texts.every((x: unknown) => {
    const text = x as Record<string, unknown> | null;
    return !!text && typeof text.key === 'string' && typeof text.label === 'string' && isStrings(text.items);
  });
  const topicsOk = t.topics.every((x: unknown) => {
    const topic = x as Record<string, unknown> | null;
    return (
      !!topic &&
      typeof topic.ask === 'string' &&
      typeof topic.scope === 'string' &&
      typeof topic.frame === 'string' &&
      typeof topic.target === 'number' &&
      isStrings(topic.from)
    );
  });
  return textsOk && topicsOk ? (value as Territory) : null;
}
