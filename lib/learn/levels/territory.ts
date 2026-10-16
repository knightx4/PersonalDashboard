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
};

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
};

export type Territory = {
  key: string;
  name: string;
  /** Name of the subject lens the topics join; the goal lens takes them in through learn 0137. */
  subjectLens: string;
  performances: string[];
  /** Phrases naming roles in job_search whose requirement lines join the sources. */
  roles: string[];
  texts: TerritoryText[];
  topics: TerritoryTopic[];
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

/** The topics still to draft, in order: those whose ask is not yet on any topic. */
export function topicsLeft(territory: Territory, asked: readonly (string | null)[]): TerritoryTopic[] {
  const done = new Set(asked.filter((a): a is string => a !== null).map((a) => a.trim().toLowerCase()));
  return territory.topics.filter((t) => !done.has(t.ask.trim().toLowerCase()));
}
