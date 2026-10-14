import 'server-only';

import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import { loadPlaces } from '@/lib/learn/places/load';
import type { StrengthInput } from '@/lib/learn/strength';
import { EVIDENCE_COLUMNS } from '@/lib/learn/evidence/links';
import { evidenceFromRows, type EvidenceLink, type EvidenceRow } from '@/lib/learn/evidence/model';
import { placeAreas, type DomainPlacement, type FieldPlacement } from './area-map';
import { buildIdeaMap, type IdeaMap, type MapIdea } from './idea-map';
import type { Point } from './layout';
import { lightOn } from './sky';

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
  /** The columns of its state row the strength score reads, or null for an idea never seen. */
  stateRow: StrengthInput | null;
  /** How well you know it on `asOf`, from 0 to 1 (plan #1997.6). */
  strength: number;
  /** For an idea not known yet, the light its known neighbours spill onto it, from 0 to 1. */
  haze: number;
  /** The place it is in (plan #1997.3), or null for an idea in none. */
  placeId: string | null;
  /** When the idea was written, which the timeline replays from (plan #1997.8). */
  createdAt: string | null;
  /**
   * The notes, courses and work that back it, strongest first (plan #2006.6).
   * The strength above already counts them; the card lists the first three.
   */
  evidence: EvidenceLink[];
};

/** A named place on the map, at the middle of its ideas in each layout. */
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
};

type ConceptRow = {
  id: string;
  name: string;
  claim: string;
  subject_id: string | null;
  embedding: string | number[] | null;
  created_at: string | null;
};
type StateRow = {
  concept_id: string;
  state: KnowledgeState;
  established: StateBasis;
  tested_at: string | null;
  declared_at: string | null;
  review_interval_days: number | null;
};
type DustRow = { note_id: string; concept_id: string; similarity: number };
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

export async function loadIdeaMap(
  learn: LearnSupabaseClient,
  userId?: string,
  asOf: Date = new Date(),
): Promise<IdeaMapView> {
  const own = (table: 'concepts' | 'concept_state' | 'subjects' | 'vault_dust', columns: string, order: string) =>
    <T>(from: number, to: number) => {
      let query = learn.from(table).select(columns);
      if (userId) query = query.eq('user_id', userId);
      return query.order(order).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    };

  const [concepts, states, subjects, fields, domains, placeRead, dustRows, evidenceRows] = await Promise.all([
    readAll<ConceptRow>(own('concepts', 'id, name, claim, subject_id, embedding, created_at', 'id')),
    readAll<StateRow>(
      own(
        'concept_state',
        'concept_id, state, established, tested_at, declared_at, review_interval_days',
        'concept_id',
      ),
    ),
    readAll<SubjectRow>(own('subjects', 'id, name, field_id, domain_id', 'id')),
    readAll<FieldRow>((from, to) => learn.from('area_fields').select('id, name, domain_id, embedding').order('id').range(from, to)),
    readAll<DomainRow>((from, to) => learn.from('area_domains').select('id, name').order('id').range(from, to)),
    // The places and the dust are drawn when they are there; a failed read of
    // either leaves them off rather than losing the whole map.
    loadPlaces(learn, userId).catch((error: unknown) => {
      console.error('[learn idea map] places', error instanceof Error ? error.message : error);
      return null;
    }),
    readAll<DustRow>(own('vault_dust', 'note_id, concept_id, similarity', 'note_id')).catch((error: unknown) => {
      console.error('[learn idea map] dust', error instanceof Error ? error.message : error);
      return [] as DustRow[];
    }),
    // What backs each idea (plan #2006.6). Without it the map lights as before.
    readAll<EvidenceRow>((from, to) => {
      let query = learn.from('evidence_links').select(EVIDENCE_COLUMNS).eq('target_kind', 'idea');
      if (userId) query = query.eq('user_id', userId);
      return query.order('id').range(from, to);
    }).catch((error: unknown) => {
      console.error('[learn idea map] evidence', error instanceof Error ? error.message : error);
      return [] as EvidenceRow[];
    }),
  ]);

  const evidenceOf = new Map<string, EvidenceRow[]>();
  for (const row of evidenceRows) {
    const list = evidenceOf.get(row.target_id) ?? [];
    list.push(row);
    evidenceOf.set(row.target_id, list);
  }
  const linksOf = (id: string): EvidenceLink[] => evidenceFromRows(evidenceOf.get(id) ?? []);

  const rowOfState = new Map(states.map((row) => [row.concept_id, row]));
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

  const stateRowOf = (id: string): StrengthInput | null => {
    const row = rowOfState.get(id);
    return row
      ? {
          state: row.state,
          established: row.established,
          tested_at: row.tested_at,
          declared_at: row.declared_at,
          review_interval_days: row.review_interval_days,
        }
      : null;
  };
  const light = lightOn(
    map.ideas.map((idea) => ({
      id: idea.id,
      stateRow: stateRowOf(idea.id),
      neighbours: idea.neighbours,
      evidence: evidenceOf.get(idea.id)?.map((row) => ({
        weight: row.weight,
        similarity: row.similarity,
        foundAt: row.found_at,
      })),
    })),
    asOf,
  );

  // Each named place at the middle of its ideas on the map.
  const placed = new Map(map.ideas.map((idea) => [idea.id, idea]));
  const places: PlaceOnMap[] = [];
  for (const place of placeRead?.places ?? []) {
    if (!place.name) continue;
    const members = place.memberIds.map((id) => placed.get(id)).filter((idea) => idea !== undefined);
    if (members.length === 0) continue;
    const mean = (pick: (idea: MapIdea) => Point): Point => ({
      x: members.reduce((sum, idea) => sum + pick(idea).x, 0) / members.length,
      y: members.reduce((sum, idea) => sum + pick(idea).y, 0) / members.length,
    });
    places.push({
      id: place.id,
      name: place.name,
      ideaCount: members.length,
      pca: mean((idea) => idea.pca),
      neighbourMap: mean((idea) => idea.neighbourMap),
    });
  }

  return {
    ...map,
    missing: concepts.length - embedded.length,
    asOf: asOf.toISOString(),
    places,
    dust: dustRows
      .filter((row) => placed.has(row.concept_id))
      .map((row) => ({ noteId: row.note_id, conceptId: row.concept_id, similarity: row.similarity })),
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
        stateRow: stateRowOf(idea.id),
        strength: light.get(idea.id)?.strength ?? 0,
        haze: light.get(idea.id)?.haze ?? 0,
        placeId: placeRead?.placeOf.get(idea.id) ?? null,
        createdAt: row.created_at ?? null,
        evidence: linksOf(idea.id),
      };
    }),
  };
}
