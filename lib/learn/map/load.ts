import 'server-only';

import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import { placeAreas, type DomainPlacement, type FieldPlacement } from './area-map';
import { buildIdeaMap, type IdeaMap, type MapIdea } from './idea-map';

/**
 * Reading the Idea Space map (plan #1855).
 *
 * Reads every idea that has an embedding, with its state, track, field and
 * domain, and hands the vectors to `buildIdeaMap`. Nothing is stored: at a
 * few hundred ideas the whole map takes well under a second, so the page
 * works it out on each visit and it is never out of date.
 *
 * Plain reads joined in memory, as in `lib/learn/graph/load.ts`. Through the
 * person's session RLS narrows them; `userId` names the person on every read
 * for a caller using the service role. Fields and domains are one shared
 * catalogue and are read whole.
 */

export type Named = { id: string; name: string };

export type IdeaOnMap = MapIdea & {
  name: string;
  claim: string;
  state: KnowledgeState;
  /** The track the idea was written under. */
  track: Named | null;
  field: Named | null;
  domain: Named | null;
};

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
};

type ConceptRow = {
  id: string;
  name: string;
  claim: string;
  subject_id: string | null;
  embedding: string | number[] | null;
};
type StateRow = { concept_id: string; state: KnowledgeState };
type SubjectRow = { id: string; name: string; field_id: string | null; domain_id: string | null };
type FieldRow = { id: string; name: string; domain_id: string | null; embedding: string | number[] | null };
type DomainRow = { id: string; name: string };

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

export async function loadIdeaMap(learn: LearnSupabaseClient, userId?: string): Promise<IdeaMapView> {
  const own = (table: 'concepts' | 'concept_state' | 'subjects', columns: string, order: string) =>
    <T>(from: number, to: number) => {
      let query = learn.from(table).select(columns);
      if (userId) query = query.eq('user_id', userId);
      return query.order(order).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    };

  const [concepts, states, subjects, fields, domains] = await Promise.all([
    readAll<ConceptRow>(own('concepts', 'id, name, claim, subject_id, embedding', 'id')),
    readAll<StateRow>(own('concept_state', 'concept_id, state', 'concept_id')),
    readAll<SubjectRow>(own('subjects', 'id, name, field_id, domain_id', 'id')),
    readAll<FieldRow>((from, to) => learn.from('area_fields').select('id, name, domain_id, embedding').order('id').range(from, to)),
    readAll<DomainRow>((from, to) => learn.from('area_domains').select('id, name').order('id').range(from, to)),
  ]);

  const stateOf = new Map(states.map((row) => [row.concept_id, row.state]));
  const subjectOf = new Map(subjects.map((row) => [row.id, row]));
  const fieldOf = new Map(fields.map((row) => [row.id, row]));
  const domainOf = new Map(domains.map((row) => [row.id, row]));

  const embedded: (ConceptRow & { vector: number[] })[] = [];
  for (const row of concepts) {
    const vector = parseVector(row.embedding);
    if (vector) embedded.push({ ...row, vector });
  }

  const map = buildIdeaMap(
    embedded.map((row) => ({ id: row.id, vector: row.vector, state: stateOf.get(row.id) ?? 'unknown' })),
  );
  const rowOf = new Map(embedded.map((row) => [row.id, row]));

  const ideaVectors = embedded.map((row) => ({
    id: row.id,
    vector: row.vector,
    state: stateOf.get(row.id) ?? ('unknown' as KnowledgeState),
  }));
  const fieldVectors: { id: string; domainId: string; vector: number[] }[] = [];
  for (const row of fields) {
    const vector = parseVector(row.embedding);
    if (vector && row.domain_id) fieldVectors.push({ id: row.id, domainId: row.domain_id, vector });
  }
  const areaMap = placeAreas(ideaVectors, map, fieldVectors, domains);

  // Ideas under each field and domain, by the same rule as the idea's labels.
  const fieldIdeas = new Map<string, number>();
  const domainIdeas = new Map<string, number>();
  for (const row of embedded) {
    const subject = row.subject_id ? subjectOf.get(row.subject_id) : undefined;
    const field = subject?.field_id ? fieldOf.get(subject.field_id) : undefined;
    const domainId = subject?.domain_id ?? field?.domain_id ?? null;
    if (field) fieldIdeas.set(field.id, (fieldIdeas.get(field.id) ?? 0) + 1);
    if (domainId) domainIdeas.set(domainId, (domainIdeas.get(domainId) ?? 0) + 1);
  }

  const named = (row: { id: string; name: string } | undefined): Named | null =>
    row ? { id: row.id, name: row.name } : null;

  return {
    ...map,
    missing: concepts.length - embedded.length,
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
      const subject = row.subject_id ? subjectOf.get(row.subject_id) : undefined;
      const field = subject?.field_id ? fieldOf.get(subject.field_id) : undefined;
      const domainId = subject?.domain_id ?? field?.domain_id ?? null;
      return {
        ...idea,
        name: row.name,
        claim: row.claim,
        state: stateOf.get(idea.id) ?? 'unknown',
        track: named(subject),
        field: named(field),
        domain: named(domainId ? domainOf.get(domainId) : undefined),
      };
    }),
  };
}
