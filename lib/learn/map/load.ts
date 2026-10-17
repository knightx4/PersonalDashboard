import 'server-only';

import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import type { StrengthInput } from '@/lib/learn/strength';
import { EVIDENCE_COLUMNS } from '@/lib/learn/evidence/links';
import { evidenceFromRows, type EvidenceLink, type EvidenceRow } from '@/lib/learn/evidence/model';
import type { SkyTerritory } from './place-graph';
import type { GoalLevels } from './panels';
import { readCells } from '@/lib/learn/levels/model';
import { placeAreas, type DomainPlacement, type FieldPlacement } from './area-map';
import { goalsOnMap, territoriesOnMap, type GoalOnMap, type TopicPlacement, type TopicSurroundings } from './goals';
import { loadGoalRows } from './goals-load';
import { buildIdeaMap, type IdeaMap, type MapIdea } from './idea-map';
import type { Point } from './layout';
import { lightOn } from './sky';
import { domainSlot } from './view';
import { buildTopicFrame, type TopicFrame } from './topics';
import { loadTopicRows } from './topics-load';
import { topicStanding, type TopicLevels } from './topic-stars';

/**
 * Reading the Idea Space map (plan #1855, #2317.2).
 *
 * A star is a topic of a subject you prepared: every topic on a subject's
 * lens (lib/learn/map/goals-load.ts), placed by its scope's embedding through
 * `buildIdeaMap`, lit by your answers on its cells and by the evidence on the
 * Wikipedia topic it refines. The claims-graph ideas are no longer stars and
 * place nothing: each is listed under the topic it attaches to. Nothing is
 * stored: the page works the map out on each visit, so it is never out of date.
 *
 * Plain reads joined in memory, through the person's session, whose RLS keeps
 * every read to theirs and the shared catalogue. Fields and domains are one
 * shared catalogue and are read whole.
 *
 * The types keep the names they had when a star was an idea (`IdeaOnMap`,
 * `ideas`), since the sky, the timeline and the rail draw a topic the same way.
 */

export type Named = { id: string; name: string };

/** A star: one of your prepared topics (plan #2317.2). */
export type IdeaOnMap = MapIdea & {
  name: string;
  /** What the topic covers: its scope. */
  claim: string;
  state: KnowledgeState;
  /** The subject the topic was prepared under. */
  track: Named | null;
  field: Named | null;
  domain: Named | null;
  /** The columns of its state row the strength score reads, or null for an idea never seen. */
  stateRow: StrengthInput | null;
  /** How well your answers say you know it on `asOf`, from 0 to 1 (plan #1997.6): tested only (plan #2187.1). */
  strength: number;
  /** For an idea with no tested strength, the light its tested neighbours spill onto it, from 0 to 1. */
  haze: number;
  /** How strongly a course, your work, your writing or your own word touched it, from 0 to 1: the gold halo. */
  exposure: number;
  /** The place it is in: its subject's territory, by the lens id (plan #2317.2), or null for none. */
  placeId: string | null;
  /** When the idea was written, which the timeline replays from (plan #1997.8). */
  createdAt: string | null;
  /**
   * The notes, courses and work that back it, strongest first (plan #2006.6).
   * They give it a halo (exposure above), never strength; the card lists the first three.
   */
  evidence: EvidenceLink[];
  /** The levels held on the topic: shown by an answer, held at all, and its ceiling (plan #2317.2). */
  levels?: TopicLevels;
  /** The claims-graph ideas attached to the Wikipedia topic it refines, by name. */
  ideasUnder?: Named[];
};

/** A named place on the map, at the middle of its stars in each layout: a subject's territory (plan #2317.2). */
export type PlaceOnMap = { id: string; name: string; ideaCount: number; pca: Point; neighbourMap: Point };

/** A vault note drawn as dust beside the idea it is most like. */
export type DustOnMap = { noteId: string; conceptId: string; similarity: number };

/** A field of the area catalogue placed on the map (plan #1856). */
export type FieldOnMap = FieldPlacement & {
  name: string;
  domain: Named | null;
  /** Ideas on the map under this field. Zero marks ground you have not been to. */
  ideaCount: number;
};

export type DomainOnMap = DomainPlacement & { name: string; ideaCount: number };

export type IdeaMapView = Omit<IdeaMap, 'ideas'> & {
  ideas: IdeaOnMap[];
  /** Every embedded field and domain with a position, in both layouts, ideas or none. */
  areas: { fields: FieldOnMap[]; domains: DomainOnMap[]; fieldsMissing: number };
  /** Ideas with no embedding yet, left off the map until the daily fill reaches them. */
  missing: number;
  /** The moment the strengths were worked out for, as an ISO string. */
  asOf: string;
  /** The named places, biggest first. A place the daily run has not named yet is left out. */
  places: PlaceOnMap[];
  dust: DustOnMap[];
  /**
   * Wikipedia's Level 3 topics and the Level 4 ones something touches, as the
   * map's frame (plan #2016.5), or null when they could not be read.
   */
  topics: TopicFrame | null;
  /**
   * The goals' territories (plan #2187.3), each topic with its ladder, for
   * the graph a chosen goal's topic opens. Undefined where nothing loads them.
   */
  territories?: SkyTerritory[];
  /**
   * Your open learning goals, each with its topics placed on the sky and the
   * requirements between them (plan #2187.2). Null when they could not be
   * read; left out where nothing reads them, as in most gallery entries.
   */
  goals?: GoalOnMap[] | null;
  /**
   * The topic map and each goal's targets, for the panels under the map
   * (plan #2187.6), which work the gaps and an earlier day's levels out in
   * the browser. Null when they could not be read; left out where nothing
   * reads them, and then the panels are not drawn.
   */
  levels?: GoalLevels | null;
};

/**
 * A stored vector as PostgREST returns it, the text `[0.1,0.2,…]`, or null
 * when it is not one of the width the map works in.
 */
export function parseVector(value: string | number[] | null): number[] | null {
  if (value == null) return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length !== EMBEDDING_DIMENSIONS) return null;
  return parsed.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (parsed as number[]) : null;
}

type FieldRow = { id: string; name: string; domain_id: string | null; embedding: string | number[] | null };
type DomainRow = { id: string; name: string };
type ConceptRow = { id: string; name: string };
type ParentRow = { concept_id: string; topic_id: string };

/** Ids per `in` filter, so a request's address stays short. */
const IN_CHUNK = 200;

/** A topic not on the map of levels still has ten levels to climb. */
const DEFAULT_CEILING = 10;

export async function loadIdeaMap(learn: LearnSupabaseClient, asOf: Date = new Date()): Promise<IdeaMapView> {
  const logged =
    <T>(what: string, fallback: T) =>
    (error: unknown): T => {
      console.error(`[learn idea map] ${what}`, error instanceof Error ? error.message : error);
      return fallback;
    };

  const [goalRows, fields, domains, concepts, parents] = await Promise.all([
    // The stars. Without them there is no map, so a failure is the page's to say.
    loadGoalRows(learn),
    readAll<FieldRow>((from, to) => learn.from('area_fields').select('id, name, domain_id, embedding').order('id').range(from, to)),
    readAll<DomainRow>((from, to) => learn.from('area_domains').select('id, name').order('id').range(from, to)),
    // The ideas listed under each topic. Without them the card lists none.
    readAll<ConceptRow>((from, to) => learn.from('concepts').select('id, name').order('id').range(from, to)).catch(
      logged('ideas', [] as ConceptRow[]),
    ),
    readAll<ParentRow>((from, to) =>
      learn.from('idea_topic_parents').select('concept_id, topic_id').order('concept_id').range(from, to),
    ).catch(logged('idea parents', [] as ParentRow[])),
  ]);

  const subjectOf = new Map(goalRows.subjects.map((row) => [row.id, row]));
  const fieldOf = new Map(fields.map((row) => [row.id, row]));
  const domainOf = new Map(domains.map((row) => [row.id, row]));
  const named = (row: { id: string; name: string } | undefined): Named | null =>
    row ? { id: row.id, name: row.name } : null;

  // Each topic's territory: the first lens, by name, that has it.
  const lensOf = new Map<string, (typeof goalRows.lenses)[number]>();
  for (const lens of goalRows.lenses) {
    for (const t of lens.targets) if (!lensOf.has(t.topicId)) lensOf.set(t.topicId, lens);
  }

  const readings = readCells(goalRows.map);
  const ceilingOf = new Map(goalRows.map.topics.map((t) => [t.id, t.ceiling]));
  const standingOf = new Map(
    goalRows.topics.map((row) => [row.id, topicStanding(row.id, ceilingOf.get(row.id) ?? DEFAULT_CEILING, readings)]),
  );

  const embedded = goalRows.topics.flatMap((row) => {
    const vector = parseVector(row.scope_embedding);
    return vector ? [{ ...row, vector }] : [];
  });
  const rowOf = new Map(embedded.map((row) => [row.id, row]));
  const ideaVectors = embedded.map((row) => ({
    id: row.id,
    vector: row.vector,
    state: standingOf.get(row.id)?.stateRow?.state ?? ('unknown' as KnowledgeState),
  }));
  const map = buildIdeaMap(ideaVectors);

  const fieldVectors: { id: string; domainId: string; vector: number[] }[] = [];
  for (const row of fields) {
    const vector = parseVector(row.embedding);
    if (vector && row.domain_id) fieldVectors.push({ id: row.id, domainId: row.domain_id, vector });
  }
  const areaMap = placeAreas(ideaVectors, map, fieldVectors, domains);

  // Each star's subject, field and domain.
  const where = (topicId: string) => {
    const lens = lensOf.get(topicId);
    const subject = lens?.subjectId ? subjectOf.get(lens.subjectId) : undefined;
    const field = subject?.field_id ? fieldOf.get(subject.field_id) : undefined;
    const domainId = subject?.domain_id ?? field?.domain_id ?? null;
    return { lens, subject, field, domain: domainId ? domainOf.get(domainId) : undefined };
  };

  // The second round, once the topics are known: the evidence on the Wikipedia
  // topics they refine, and the frame drawn round them.
  const articles = [...new Set(embedded.flatMap((row) => (row.refines_article_id ? [row.refines_article_id] : [])))].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < articles.length; i += IN_CHUNK) chunks.push(articles.slice(i, i + IN_CHUNK));
  const [evidenceRows, topicRows] = await Promise.all([
    Promise.all(
      chunks.map(async (chunk) => {
        const { data, error } = await learn
          .from('evidence_links')
          .select(EVIDENCE_COLUMNS)
          .eq('target_kind', 'topic')
          .neq('kind', 'mention')
          .in('target_id', chunk);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as EvidenceRow[];
      }),
    )
      .then((lists) => lists.flat())
      .catch(logged('evidence', [] as EvidenceRow[])),
    // The frame (plan #2016.5), each star under the topic it refines. Without it the sky draws the stars alone.
    loadTopicRows(
      learn,
      undefined,
      embedded.flatMap((row) => (row.refines_article_id ? [{ concept_id: row.id, topic_id: row.refines_article_id }] : [])),
    ).catch(logged('topics', null)),
  ]);

  const evidenceOf = new Map<string, EvidenceRow[]>();
  for (const row of evidenceRows) {
    const list = evidenceOf.get(row.target_id) ?? [];
    list.push(row);
    evidenceOf.set(row.target_id, list);
  }
  const evidenceFor = (topicId: string): EvidenceRow[] => {
    const article = rowOf.get(topicId)?.refines_article_id;
    return article ? (evidenceOf.get(article) ?? []) : [];
  };

  const conceptName = new Map(concepts.map((row) => [row.id, row.name]));
  const ideasByArticle = new Map<string, Named[]>();
  for (const p of parents) {
    const name = conceptName.get(p.concept_id);
    if (!name) continue;
    const list = ideasByArticle.get(p.topic_id) ?? [];
    list.push({ id: p.concept_id, name });
    ideasByArticle.set(p.topic_id, list);
  }

  const light = lightOn(
    map.ideas.map((idea) => ({
      id: idea.id,
      stateRow: standingOf.get(idea.id)?.stateRow ?? null,
      neighbours: idea.neighbours,
      evidence: evidenceFor(idea.id).map((row) => ({
        kind: row.kind,
        ceiling: row.ceiling,
        similarity: row.similarity,
        foundAt: row.found_at,
      })),
    })),
    asOf,
  );

  // Each subject's territory is a place, at the middle of its stars.
  const membersOf = new Map<string, MapIdea[]>();
  for (const idea of map.ideas) {
    const lens = lensOf.get(idea.id);
    if (lens) membersOf.set(lens.id, [...(membersOf.get(lens.id) ?? []), idea]);
  }
  const places: PlaceOnMap[] = goalRows.lenses.flatMap((lens) => {
    const members = membersOf.get(lens.id) ?? [];
    if (members.length === 0) return [];
    const mean = (pick: (idea: MapIdea) => Point): Point => ({
      x: members.reduce((sum, idea) => sum + pick(idea).x, 0) / members.length,
      y: members.reduce((sum, idea) => sum + pick(idea).y, 0) / members.length,
    });
    return [
      { id: lens.id, name: lens.name, ideaCount: members.length, pca: mean((i) => i.pca), neighbourMap: mean((i) => i.neighbourMap) },
    ];
  });
  places.sort((a, b) => b.ideaCount - a.ideaCount || a.name.localeCompare(b.name));

  const topics = topicRows
    ? buildTopicFrame(
        topicRows,
        map.ideas.map((idea) => ({
          id: idea.id,
          pca: idea.pca,
          neighbourMap: idea.neighbourMap,
          stateRow: standingOf.get(idea.id)?.stateRow ?? null,
        })),
        areaMap.fields,
        asOf,
      )
    : null;

  // The goals and territories, on the stars' own places, coloured by their subject's domain.
  const placedTopics = new Map<string, TopicPlacement>(
    map.ideas.map((idea) => [idea.id, { pca: idea.pca, neighbourMap: idea.neighbourMap }]),
  );
  const around = new Map<string, TopicSurroundings>(
    map.ideas.map((idea) => {
      const domain = where(idea.id).domain;
      return [idea.id, { ideaIds: [], slot: domain ? domainSlot(domain.name) : 'none' }];
    }),
  );
  const goals: GoalOnMap[] = goalsOnMap(goalRows.lenses, goalRows.map, readings, placedTopics, goalRows.goalNames);
  const territories: SkyTerritory[] = territoriesOnMap(goalRows.lenses, goalRows.map, readings, placedTopics, around);
  const levels: GoalLevels = {
    map: goalRows.map,
    lenses: goalRows.lenses.map((lens) => ({
      id: lens.id,
      name: lens.name,
      targets: lens.targets.map((t) => ({ topicId: t.topicId, targetLevel: t.targetLevel })),
    })),
  };

  // Stars under each field and domain, by the same rule as the star's labels.
  const fieldIdeas = new Map<string, number>();
  const domainIdeas = new Map<string, number>();
  for (const row of embedded) {
    const { field, domain } = where(row.id);
    if (field) fieldIdeas.set(field.id, (fieldIdeas.get(field.id) ?? 0) + 1);
    if (domain) domainIdeas.set(domain.id, (domainIdeas.get(domain.id) ?? 0) + 1);
  }

  return {
    ...map,
    topics,
    goals,
    territories,
    levels,
    missing: goalRows.topics.length - embedded.length,
    asOf: asOf.toISOString(),
    places,
    dust: [],
    areas: {
      fieldsMissing: fields.length - fieldVectors.length,
      fields: areaMap.fields.map((placement) => {
        const row = fieldOf.get(placement.id)!;
        return {
          ...placement,
          name: row.name,
          domain: named(row.domain_id ? domainOf.get(row.domain_id) : undefined),
          ideaCount: fieldIdeas.get(placement.id) ?? 0,
        };
      }),
      domains: areaMap.domains.map((placement) => ({
        ...placement,
        name: domainOf.get(placement.id)!.name,
        ideaCount: domainIdeas.get(placement.id) ?? 0,
      })),
    },
    ideas: map.ideas.map((idea) => {
      const row = rowOf.get(idea.id)!;
      const { lens, subject, field, domain } = where(idea.id);
      const standing = standingOf.get(idea.id);
      const light1 = light.get(idea.id);
      return {
        ...idea,
        name: row.name,
        claim: row.scope ?? '',
        state: standing?.stateRow?.state ?? 'unknown',
        track: named(subject),
        field: named(field),
        domain: named(domain),
        stateRow: standing?.stateRow ?? null,
        strength: light1?.strength ?? 0,
        haze: light1?.haze ?? 0,
        exposure: light1?.exposure ?? 0,
        placeId: lens?.id ?? null,
        createdAt: row.created_at ?? null,
        evidence: evidenceFromRows(evidenceFor(idea.id)),
        levels: standing?.levels,
        ideasUnder: [...((row.refines_article_id && ideasByArticle.get(row.refines_article_id)) || [])].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
    }),
  };
}

