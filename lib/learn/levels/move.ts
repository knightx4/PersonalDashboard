import { z } from 'zod';
import { MAX_LEVEL, type Verdict } from '@/lib/learn/levels/model';
import type { MapTopic } from '@/lib/learn/levels/draft-payload';

/**
 * Moving the claims graph onto topics (docs/LEARN-LEVELS-SPEC.md, "Migration
 * from the claims graph"; plan #2138.4).
 *
 * Pure: what the assignment call reports and how it is read, and the rules
 * for steps 2 to 4 of the spec, which decide what a concept's state, an edge
 * and a subject become. The call is in move-call.ts and the writes in
 * move-store.ts; everything that decides an outcome is here, where it can be
 * tested without either.
 */

// ---------------------------------------------------------------------------
// The assignment call's report.
// ---------------------------------------------------------------------------

const levelNumber = z.number().int().min(1).max(MAX_LEVEL);

export const assignPayloadSchema = z.object({
  placements: z.array(
    z.object({
      /** The concept's number in the list the call was given, from 1. */
      concept: z.number().int().min(1),
      /** A topic on the map by its exact name, or one listed under new_topics. */
      topic: z.string(),
      level: levelNumber,
      /** Set when the call is not sure, with why. */
      unsure: z.string().optional(),
    }),
  ),
  new_topics: z
    .array(
      z.object({
        name: z.string(),
        scope: z.string(),
      }),
    )
    .default([]),
});

export type AssignPayload = z.infer<typeof assignPayloadSchema>;

/** A concept as the call is told about it. */
export type MoveConcept = { id: string; name: string; claim: string };

/** Where one concept goes: a topic on the map, or one to draft first. */
export type Placement = {
  conceptId: string;
  /** Set when the topic is on the map already. */
  topicId: string | null;
  /** The topic's name: the map's, or the new one's. */
  topicName: string;
  level: number;
  /** Why the call was unsure, or null when it was sure. */
  unsure: string | null;
};

export type NewTopic = { name: string; scope: string };

export type Assignment = {
  placements: Placement[];
  /** Topics to draft before the placements onto them can be written. */
  newTopics: NewTopic[];
  /** Concepts the call left out or put somewhere that does not exist. */
  unplaced: string[];
};

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();
const key = (text: string): string => tidy(text).toLowerCase();

/**
 * The call's report, checked against the concepts and the map.
 *
 * A placement on a topic the map has is clamped to that topic's ceiling and
 * marked unsure when it had to be, so the person sees it. A placement on a
 * new topic needs that topic listed under new_topics with a scope; a new
 * topic named like one on the map is the map's. A concept placed twice keeps
 * its first placement. A concept with no usable placement is listed as
 * unplaced, which the subject's move reports as a failure to try again.
 */
export function readAssignment(
  payload: AssignPayload,
  concepts: readonly MoveConcept[],
  map: readonly MapTopic[],
): Assignment {
  const mapByName = new Map(map.map((t) => [key(t.name), t]));
  const newByName = new Map<string, NewTopic>();
  for (const entry of payload.new_topics) {
    const name = tidy(entry.name);
    const scope = tidy(entry.scope);
    if (name === '' || scope === '' || mapByName.has(key(name)) || newByName.has(key(name))) continue;
    newByName.set(key(name), { name, scope });
  }

  const placed = new Map<string, Placement>();
  for (const row of payload.placements) {
    const concept = concepts[row.concept - 1];
    if (!concept || placed.has(concept.id)) continue;
    const named = key(row.topic);
    const onMap = mapByName.get(named);
    const unsure = row.unsure && tidy(row.unsure) !== '' ? tidy(row.unsure) : null;
    if (onMap) {
      const level = Math.min(row.level, onMap.ceiling);
      placed.set(concept.id, {
        conceptId: concept.id,
        topicId: onMap.id,
        topicName: onMap.name,
        level,
        unsure:
          unsure ??
          (level < row.level ? `Dash put it at level ${row.level}, above where ${onMap.name} stops, so it sits at ${level}.` : null),
      });
      continue;
    }
    const fresh = newByName.get(named);
    if (!fresh) continue;
    placed.set(concept.id, { conceptId: concept.id, topicId: null, topicName: fresh.name, level: row.level, unsure });
  }

  const used = new Set([...placed.values()].filter((p) => p.topicId === null).map((p) => key(p.topicName)));
  return {
    placements: concepts.flatMap((c) => {
      const p = placed.get(c.id);
      return p ? [p] : [];
    }),
    newTopics: [...newByName.values()].filter((t) => used.has(key(t.name))),
    unplaced: concepts.filter((c) => !placed.has(c.id)).map((c) => c.id),
  };
}

// ---------------------------------------------------------------------------
// Step 2: states to evidence.
// ---------------------------------------------------------------------------

export type ConceptState = {
  state: string;
  established: string;
  testedAt: string | null;
  declaredAt: string | null;
  updatedAt: string | null;
};

/**
 * What a concept's state writes at the cell it landed on, or null for
 * nothing.
 *
 * Shaky and misconception write not met, whatever their basis: a declared
 * shaky is the person saying they do not have it. Otherwise a declared state
 * writes declared. Known and sharp, tested, write met; recognised writes met
 * only at levels 1 and 2, since picking an idea out of four shows no more
 * than that. Inferred writes nothing, because implication is now computed,
 * and unknown has nothing to carry.
 */
export function evidenceFromState(state: ConceptState, level: number): { verdict: Verdict; observedAt: string } | null {
  const when = (at: string | null) => at ?? state.updatedAt ?? new Date(0).toISOString();
  if (state.established === 'inferred' || state.state === 'unknown') return null;
  if (state.state === 'shaky' || state.state === 'misconception') {
    return { verdict: 'not_met', observedAt: when(state.testedAt ?? state.declaredAt) };
  }
  if (state.established === 'declared') return { verdict: 'declared', observedAt: when(state.declaredAt) };
  if (state.state === 'known' || state.state === 'sharp') return { verdict: 'met', observedAt: when(state.testedAt) };
  if (state.state === 'recognised' && level <= 2) return { verdict: 'met', observedAt: when(state.testedAt) };
  return null;
}

// ---------------------------------------------------------------------------
// Step 3: edges to links.
// ---------------------------------------------------------------------------

/** Where a concept sits once placed. */
export type Seat = { topicId: string; level: number };

export type EdgeOutcome =
  | { kind: 'link' }
  | { kind: 'chain' }
  | { kind: 'review' }
  | { kind: 'unplaced' };

/**
 * What one edge becomes. Across topics it is a link from the dependent's
 * cell to the prerequisite's. Inside one topic the level chain covers it,
 * unless the prerequisite sits higher than what needs it, which the person
 * resolves.
 */
export function edgeOutcome(prerequisite: Seat | undefined, dependent: Seat | undefined): EdgeOutcome {
  if (!prerequisite || !dependent) return { kind: 'unplaced' };
  if (prerequisite.topicId !== dependent.topicId) return { kind: 'link' };
  return prerequisite.level > dependent.level ? { kind: 'review' } : { kind: 'chain' };
}

/** The sentence a downward edge is listed with. */
export function downwardWhy(prerequisite: string, dependent: string, topic: string, prereqLevel: number, depLevel: number): string {
  return `On ${topic}, ${prerequisite} sits at level ${prereqLevel}, above ${dependent} at level ${depLevel}, which needs it.`;
}

// ---------------------------------------------------------------------------
// Step 4: subjects to lenses.
// ---------------------------------------------------------------------------

/** Each topic the subject's concepts landed on, with the highest level any reached. */
export function lensTargets(seats: readonly Seat[]): Map<string, number> {
  const targets = new Map<string, number>();
  for (const seat of seats) targets.set(seat.topicId, Math.max(targets.get(seat.topicId) ?? 0, seat.level));
  return targets;
}

// ---------------------------------------------------------------------------
// The review page.
// ---------------------------------------------------------------------------

/** One subject's move as the review page lists it. */
export type MoveRow = {
  subjectId: string;
  subjectName: string;
  status: 'moved' | 'failed' | 'waiting';
  detail: string | null;
};

/** Counts for the line under the review page's header. */
export function moveCounts(rows: readonly MoveRow[]): { moved: number; failed: number; waiting: number } {
  return {
    moved: rows.filter((r) => r.status === 'moved').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    waiting: rows.filter((r) => r.status === 'waiting').length,
  };
}
