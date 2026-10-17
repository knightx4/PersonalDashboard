import { groupReach, type Reach, type Readings, type TopicMap } from '@/lib/learn/levels/model';
import { EVIDENCE_CEILING, evidenceStrength, isMisconception, strength, type EvidenceWeight, type StrengthInput } from '@/lib/learn/strength';
import { EVIDENCE_KINDS, type EvidenceKind } from './kinds';

/**
 * The state of each topic on a day (plan #2016.4). Pure, so the map and the
 * tests ask for any date.
 *
 * - hidden: a Level 4 topic nothing touches. A Level 3 topic is never hidden.
 * - unlocked: something touches it (a link to it from a note, course, work
 *   entry or idea, or an idea of yours attached to it) but nothing lights it.
 * - lit: ideas beneath it are known or evidence backs it, with a strength.
 *
 * Strength rolls up from two places and the larger counts:
 *
 * - the ideas beneath it, each scored by `strength` (its own state, level
 *   times evidence times memory, so a question or a declaration), combined as
 *   1 - product(1 - score) so each idea adds to the rest without passing 1.
 *   An idea held only on evidence scores 0 here: its evidence reaches the
 *   topic through the topic's own links, so it is not counted twice.
 * - the topic's own evidence links, as `evidenceStrength` does for an idea
 *   with the similarity halved for a link that matched by name alone, and
 *   capped at EVIDENCE_CEILING (decision #2006.2). Evidence alone never lifts
 *   a topic past recognised, however many links there are, and each kind
 *   never past its own ceiling (plan #2172.2). A mention neither lights nor
 *   unlocks: it is left out before anything is counted.
 *
 * A Level 3 topic takes the ideas of every Level 4 topic under it as well as
 * its own, and its own links only.
 *
 * Breadth and depth (plan #2172.2) come from the levels model of #2138.10:
 * the topics on your map that refine a frame topic (`refines_article_id`)
 * are its children, and `groupReach` says how many of them you have touched
 * and the best level reached, each per kind (tested, inferred, declared).
 * A Level 3 topic counts the topics refining its Level 4 topics too. They
 * are reported beside the strength and never folded into it.
 */

/** Strength a topic needs to be lit rather than merely unlocked. */
export const LIT_MIN = 0.1;
/** A link that matched a topic by its name alone counts this share of its similarity. */
export const NAME_ONLY_SHARE = 0.5;

export type TopicNode = { id: string; level: 3 | 4; parentId: string | null };

/** An idea attached to a topic (learn.idea_topic_parents) and its state row, if it has one. */
export type TopicIdea = { id: string; topicId: string; state: StrengthInput | null };

export type TopicLink = EvidenceWeight & { matchedBy?: 'name' | 'similarity' | null };

/** Your topics refining each frame topic, and the levels model to read them by (plan #2172.2). */
export type TopicLevels = {
  map: TopicMap;
  readings: Readings;
  /** Frame topic id to the ids of the level topics that refine it. */
  refining: ReadonlyMap<string, readonly string[]>;
};

export type TopicStateName = 'hidden' | 'unlocked' | 'lit';

export type TopicState = {
  topicId: string;
  state: TopicStateName;
  /** 0 to 1; 0 unless lit. */
  strength: number;
  /** Lit by evidence alone, so held at or below recognised. */
  evidenceOnly: boolean;
  ideaCount: number;
  /** Links that count: mentions are left out. */
  linkCount: number;
  /** The kinds of evidence among those links, in the order of EVIDENCE_KINDS. */
  kinds: EvidenceKind[];
  /** Breadth and depth over the topics refining it, per kind; no children when none does. */
  reach: Reach;
};

const NO_REACH: Reach = {
  children: 0,
  breadth: { tested: 0, inferred: 0, declared: 0 },
  depth: { tested: 0, inferred: 0, declared: 0 },
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A topic link as evidence: a name-only match counts half its similarity. */
export function linkAsEvidence(link: TopicLink): EvidenceWeight {
  const similarity = link.matchedBy === 'name' ? link.similarity * NAME_ONLY_SHARE : link.similarity;
  return { kind: link.kind, ceiling: link.ceiling, similarity, foundAt: link.foundAt };
}

/** What a topic's own links are worth on `on`, never past recognised. */
export function topicEvidenceStrength(links: readonly TopicLink[], on?: Date): number {
  return Math.min(EVIDENCE_CEILING, evidenceStrength(links.map(linkAsEvidence), on));
}

/** What the ideas are worth together: each idea's own score, combined. */
export function ideasStrength(ideas: readonly Pick<TopicIdea, 'state'>[], on: Date): number {
  let missing = 1;
  for (const idea of ideas) {
    if (!idea.state || isMisconception(idea.state)) continue;
    missing *= 1 - clamp01(strength(idea.state, on));
  }
  return 1 - missing;
}

/**
 * Every topic's state. `linksByTopic` holds the links written to the topic;
 * a topic missing from it has none. Links found after `on` do not count and
 * do not unlock.
 */
export function topicStates(
  topics: readonly TopicNode[],
  ideas: readonly TopicIdea[],
  linksByTopic: ReadonlyMap<string, readonly TopicLink[]>,
  on: Date,
  levels?: TopicLevels,
): Map<string, TopicState> {
  const parentOf = new Map(topics.map((t) => [t.id, t.parentId]));
  const levelOf = new Map(topics.map((t) => [t.id, t.level]));
  const childrenOf = new Map<string, string[]>();
  for (const t of topics) {
    if (t.level !== 4 || !t.parentId) continue;
    const list = childrenOf.get(t.parentId) ?? [];
    list.push(t.id);
    childrenOf.set(t.parentId, list);
  }

  // Ideas by the topics they count for: the one they sit under and its Level 3 parent.
  const under = new Map<string, TopicIdea[]>();
  const add = (topicId: string, idea: TopicIdea) => {
    const list = under.get(topicId) ?? [];
    list.push(idea);
    under.set(topicId, list);
  };
  for (const idea of ideas) {
    if (!levelOf.has(idea.topicId)) continue;
    add(idea.topicId, idea);
    const parent = parentOf.get(idea.topicId);
    if (levelOf.get(idea.topicId) === 4 && parent && levelOf.has(parent)) add(parent, idea);
  }

  const cutoff = on.getTime();
  const out = new Map<string, TopicState>();
  for (const topic of topics) {
    const beneath = under.get(topic.id) ?? [];
    const links = (linksByTopic.get(topic.id) ?? []).filter((link) => {
      if (link.kind === 'mention') return false;
      const found = link.foundAt ? Date.parse(link.foundAt) : NaN;
      return Number.isNaN(found) || found <= cutoff;
    });

    const fromIdeas = ideasStrength(beneath, on);
    const fromEvidence = topicEvidenceStrength(links, on);
    const total = Math.max(fromIdeas, fromEvidence);
    const touched = beneath.length > 0 || links.length > 0;

    let state: TopicStateName;
    if (total >= LIT_MIN) state = 'lit';
    else if (touched || topic.level === 3) state = 'unlocked';
    else state = 'hidden';

    out.set(topic.id, {
      topicId: topic.id,
      state,
      strength: state === 'lit' ? total : 0,
      evidenceOnly: state === 'lit' && fromIdeas < LIT_MIN,
      ideaCount: beneath.length,
      linkCount: links.length,
      kinds: EVIDENCE_KINDS.filter((kind) => links.some((link) => link.kind === kind)),
      reach: levels ? reachOf(topic, levels, childrenOf) : NO_REACH,
    });
  }
  return out;
}

/** The level topics refining a frame topic, a Level 3 one taking its Level 4 topics' too. */
function reachOf(topic: TopicNode, levels: TopicLevels, childrenOf: ReadonlyMap<string, readonly string[]>): Reach {
  const ids = [...(levels.refining.get(topic.id) ?? [])];
  if (topic.level === 3) for (const child of childrenOf.get(topic.id) ?? []) ids.push(...(levels.refining.get(child) ?? []));
  if (ids.length === 0) return NO_REACH;
  return groupReach(levels.map, levels.readings, ids);
}
