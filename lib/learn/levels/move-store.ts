import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedOne } from '@/lib/learn/embed/embed';
import { draftTopic } from '@/lib/learn/levels/draft';
import { assignConcepts } from '@/lib/learn/levels/move-call';
import {
  downwardWhy,
  edgeOutcome,
  evidenceFromState,
  lensTargets,
  type ConceptState,
  type MoveConcept,
  type MoveRow,
  type Placement,
  type Seat,
} from '@/lib/learn/levels/move';
import { approveDraft, loadFieldOptions, loadMapTopics, saveDraft } from '@/lib/learn/levels/store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Moving the claims graph onto topics, one subject at a time
 * (docs/LEARN-LEVELS-SPEC.md, "Migration from the claims graph"; plan
 * #2138.4), and the answers the person gives to what it could not settle.
 *
 * The old tables are only read here: concepts, their states, edges and
 * probes. What is written is the new map (topics, cells, claims, evidence,
 * links, lenses), the probes' `cell_id`, and the bookkeeping in learn 0136.
 *
 * A subject's move can be pressed again. It takes back the claims and the
 * carried-over evidence a failed or earlier try wrote for that subject's
 * concepts before writing them again, and topics an earlier try drafted are
 * on the map by then, so the call reuses them rather than drafting twice.
 *
 * Topics the move drafts are approved as they are kept. Every concept placed
 * on them was a claim the person had already approved on the claims graph,
 * and a map of drafts would ask nothing until each was approved by hand.
 * Their levels can still be reworded on the topic's page.
 */

type Client = LearnSupabaseClient;

// ---------------------------------------------------------------------------
// Reading the review page.
// ---------------------------------------------------------------------------

/** One thing the move left for the person to answer. */
export type MoveReview = {
  id: string;
  kind: 'assignment' | 'edge';
  subjectName: string;
  why: string;
  conceptId: string;
  conceptName: string;
  /** The claim's own words, for an assignment. */
  claim: string | null;
  /** For an edge: the concept the dependent needs. */
  prerequisiteName: string | null;
  /** The topic the concept sits on, its level and ceiling. */
  topicId: string | null;
  topicName: string | null;
  level: number | null;
  ceiling: number | null;
  /** For an edge: the prerequisite's level, and the dependent's. */
  prerequisiteLevel: number | null;
};

export type MoveState = { rows: MoveRow[]; reviews: MoveReview[]; topicsMade: number };

type SeatRow = { concept_id: string; cell: { id: string; level: number; topic: { id: string; name: string; ceiling: number } | null } | null };

/** Where each of these concepts sits now, by concept id. */
async function seatsOf(client: Client, conceptIds: readonly string[]) {
  const seats = new Map<string, { cellId: string; level: number; topicId: string; topicName: string; ceiling: number }>();
  if (conceptIds.length === 0) return seats;
  const { data, error } = await client
    .from('cell_claims')
    .select('concept_id, cell:topic_cells!cell_claims_cell_fk(id, level, topic:topics!topic_cells_topic_fk(id, name, ceiling))')
    .in('concept_id', [...conceptIds]);
  if (error) throw new Error(`Reading where your ideas sit failed: ${error.message}`);
  for (const row of (data ?? []) as unknown as SeatRow[]) {
    if (!row.cell?.topic) continue;
    seats.set(row.concept_id, {
      cellId: row.cell.id,
      level: row.cell.level,
      topicId: row.cell.topic.id,
      topicName: row.cell.topic.name,
      ceiling: row.cell.topic.ceiling,
    });
  }
  return seats;
}

/**
 * Every subject with how its move went, and every review still open. Survey
 * subjects are included: they become lenses like any other (idea 2d61023e).
 */
export async function loadMoveState(client: Client): Promise<MoveState> {
  const [subjects, moves, reviews, topics] = await Promise.all([
    client.from('subjects').select('id, name').order('name'),
    client.from('graph_moves').select('subject_id, status, detail, topics_drafted'),
    client
      .from('move_reviews')
      .select('id, kind, subject_id, concept_id, prerequisite_id, why, created_at')
      .is('decision', null)
      .order('created_at'),
    client.from('topics').select('id', { count: 'exact', head: true }),
  ]);
  for (const read of [subjects, moves, reviews]) {
    if (read.error) throw new Error(`Reading the move from the claims graph failed: ${read.error.message}`);
  }

  const subjectName = new Map(((subjects.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const moveOf = new Map(
    ((moves.data ?? []) as { subject_id: string; status: 'moved' | 'failed'; detail: string | null; topics_drafted: number }[]).map(
      (m) => [m.subject_id, m],
    ),
  );
  const rows: MoveRow[] = [...subjectName.entries()].map(([id, name]) => {
    const move = moveOf.get(id);
    return { subjectId: id, subjectName: name, status: move?.status ?? 'waiting', detail: move?.detail ?? null };
  });

  const open = (reviews.data ?? []) as {
    id: string;
    kind: 'assignment' | 'edge';
    subject_id: string;
    concept_id: string;
    prerequisite_id: string | null;
    why: string;
  }[];
  const conceptIds = [...new Set(open.flatMap((r) => [r.concept_id, ...(r.prerequisite_id ? [r.prerequisite_id] : [])]))];
  const [conceptRows, seats] = await Promise.all([
    conceptIds.length > 0
      ? client.from('concepts').select('id, name, claim').in('id', conceptIds)
      : Promise.resolve({ data: [], error: null }),
    seatsOf(client, conceptIds),
  ]);
  if (conceptRows.error) throw new Error(`Reading the ideas to settle failed: ${conceptRows.error.message}`);
  const concept = new Map(((conceptRows.data ?? []) as { id: string; name: string; claim: string }[]).map((c) => [c.id, c]));

  return {
    rows,
    topicsMade: topics.count ?? 0,
    reviews: open.flatMap((r) => {
      const c = concept.get(r.concept_id);
      if (!c) return [];
      const seat = seats.get(r.concept_id);
      const prereqSeat = r.prerequisite_id ? seats.get(r.prerequisite_id) : undefined;
      return [
        {
          id: r.id,
          kind: r.kind,
          subjectName: subjectName.get(r.subject_id) ?? 'A subject',
          why: r.why,
          conceptId: r.concept_id,
          conceptName: c.name,
          claim: r.kind === 'assignment' ? c.claim : null,
          prerequisiteName: r.prerequisite_id ? (concept.get(r.prerequisite_id)?.name ?? null) : null,
          topicId: seat?.topicId ?? null,
          topicName: seat?.topicName ?? null,
          level: seat?.level ?? null,
          ceiling: seat?.ceiling ?? null,
          prerequisiteLevel: prereqSeat?.level ?? null,
        },
      ];
    }),
  };
}

/** What the topics page says about the move: subjects left, and answers waiting. */
export async function loadMoveSummary(client: Client): Promise<{ toMove: number; toAnswer: number }> {
  const [subjects, moved, open] = await Promise.all([
    client.from('subjects').select('id', { count: 'exact', head: true }),
    client.from('graph_moves').select('id', { count: 'exact', head: true }).eq('status', 'moved'),
    client.from('move_reviews').select('id', { count: 'exact', head: true }).is('decision', null),
  ]);
  for (const read of [subjects, moved, open]) {
    if (read.error) throw new Error(`Reading the move from the claims graph failed: ${read.error.message}`);
  }
  return { toMove: Math.max(0, (subjects.count ?? 0) - (moved.count ?? 0)), toAnswer: open.count ?? 0 };
}

// ---------------------------------------------------------------------------
// Moving one subject.
// ---------------------------------------------------------------------------

export type MoveResult = { ok: true; placed: number; drafted: number } | { ok: false; detail: string };

type StateRow = {
  concept_id: string;
  state: string;
  established: string;
  tested_at: string | null;
  declared_at: string | null;
  updated_at: string | null;
};

function toState(row: StateRow | undefined): ConceptState | null {
  if (!row) return null;
  return {
    state: row.state,
    established: row.established,
    testedAt: row.tested_at,
    declaredAt: row.declared_at,
    updatedAt: row.updated_at,
  };
}

async function recordMove(
  client: Client,
  userId: string,
  subjectId: string,
  outcome: { status: 'moved'; lensId: string; placed: number; drafted: number } | { status: 'failed'; detail: string; drafted: number },
): Promise<void> {
  const { error } = await client.from('graph_moves').upsert(
    {
      user_id: userId,
      subject_id: subjectId,
      status: outcome.status,
      lens_id: outcome.status === 'moved' ? outcome.lensId : null,
      detail: outcome.status === 'failed' ? outcome.detail : null,
      concepts_placed: outcome.status === 'moved' ? outcome.placed : 0,
      topics_drafted: outcome.drafted,
      moved_at: new Date().toISOString(),
    },
    { onConflict: 'subject_id' },
  );
  if (error) console.error('[learn move] recording the move', error.message);
}

/**
 * Put one concept on one cell: its claim, its carried-over evidence and its
 * old probes. Takes back whatever an earlier seat wrote for it first.
 */
async function seatConcept(
  client: Client,
  userId: string,
  conceptId: string,
  cell: { id: string; level: number },
  state: ConceptState | null,
): Promise<void> {
  await client.from('cell_claims').delete().eq('concept_id', conceptId);
  await client.from('cell_evidence').delete().eq('concept_id', conceptId).is('probe_id', null);

  const { error: claimError } = await client
    .from('cell_claims')
    .insert({ user_id: userId, cell_id: cell.id, concept_id: conceptId });
  if (claimError) throw new Error(`Putting an idea on its level failed: ${claimError.message}`);

  const evidence = state ? evidenceFromState(state, cell.level) : null;
  if (evidence) {
    const { error } = await client.from('cell_evidence').insert({
      user_id: userId,
      cell_id: cell.id,
      concept_id: conceptId,
      verdict: evidence.verdict,
      observed_at: evidence.observedAt,
    });
    if (error) throw new Error(`Carrying over what you knew failed: ${error.message}`);
  }

  const { error: probeError } = await client.from('probes').update({ cell_id: cell.id }).eq('concept_id', conceptId);
  if (probeError) throw new Error(`Pointing your old questions at the new level failed: ${probeError.message}`);
}

/** The subject's lens, made the first time, with each target raised to at least what it is given. */
async function writeLens(
  client: Client,
  userId: string,
  subject: { id: string; name: string },
  targets: ReadonlyMap<string, number>,
): Promise<string> {
  const { data: found, error } = await client.from('lenses').select('id').eq('subject_id', subject.id).maybeSingle();
  if (error) throw new Error(`Reading the subject's lens failed: ${error.message}`);
  let lensId = found?.id as string | undefined;
  if (!lensId) {
    const { data: made, error: makeError } = await client
      .from('lenses')
      .insert({ user_id: userId, name: subject.name, origin: 'subject', subject_id: subject.id })
      .select('id')
      .single();
    if (makeError || !made) throw new Error(`Making the subject's lens failed: ${makeError?.message ?? 'no row came back'}`);
    lensId = made.id as string;
  }
  if (targets.size === 0) return lensId;

  const { data: had } = await client.from('lens_targets').select('topic_id, target_level').eq('lens_id', lensId);
  const was = new Map(((had ?? []) as { topic_id: string; target_level: number }[]).map((t) => [t.topic_id, t.target_level]));
  const rows = [...targets.entries()].map(([topicId, level]) => ({
    user_id: userId,
    lens_id: lensId,
    topic_id: topicId,
    target_level: Math.max(level, was.get(topicId) ?? 0),
  }));
  const { error: targetError } = await client.from('lens_targets').upsert(rows, { onConflict: 'lens_id,topic_id' });
  if (targetError) throw new Error(`Setting the lens's targets failed: ${targetError.message}`);
  return lensId;
}

/**
 * The five steps for one subject. Records the outcome in graph_moves either
 * way, so the review page can show each failure and offer it again.
 */
export async function moveSubject(
  client: Client,
  userId: string,
  subjectId: string,
  anthropicApiKey: string,
): Promise<MoveResult> {
  let drafted = 0;
  const fail = async (detail: string): Promise<MoveResult> => {
    await recordMove(client, userId, subjectId, { status: 'failed', detail, drafted });
    return { ok: false, detail };
  };

  try {
    const { data: subject, error: subjectError } = await client
      .from('subjects')
      .select('id, name')
      .eq('id', subjectId)
      .maybeSingle();
    if (subjectError) throw new Error(subjectError.message);
    if (!subject) return { ok: false, detail: 'That subject is not one of yours, or it is no longer there.' };

    const { data: conceptRows, error: conceptError } = await client
      .from('concepts')
      .select('id, name, claim')
      .eq('subject_id', subjectId)
      .order('created_at');
    if (conceptError) throw new Error(conceptError.message);
    const concepts = (conceptRows ?? []) as MoveConcept[];

    // A subject with no ideas is a lens with no topics yet.
    if (concepts.length === 0) {
      const lensId = await writeLens(client, userId, subject, new Map());
      await recordMove(client, userId, subjectId, { status: 'moved', lensId, placed: 0, drafted: 0 });
      return { ok: true, placed: 0, drafted: 0 };
    }

    const ids = concepts.map((c) => c.id);
    const [stateRows, edgeRows, map, fields] = await Promise.all([
      client.from('concept_state').select('concept_id, state, established, tested_at, declared_at, updated_at').in('concept_id', ids),
      client.from('concept_edges').select('prerequisite_id, dependent_id').eq('subject_id', subjectId),
      loadMapTopics(client),
      loadFieldOptions(client),
    ]);
    if (stateRows.error) throw new Error(stateRows.error.message);
    if (edgeRows.error) throw new Error(edgeRows.error.message);
    const stateOf = new Map(((stateRows.data ?? []) as StateRow[]).map((s) => [s.concept_id, s]));

    // Step 1: the call places each concept.
    const placing = collectSpend();
    const assigned = await assignConcepts({ subject: subject.name, concepts, map, anthropicApiKey, onSpend: placing.sink });
    await recordLearnSpend(userId, 'assign-topics', placing.reports);
    if (!assigned.ok) return fail(`Dash could not place the ideas. ${assigned.detail}`);
    const { assignment } = assigned;
    if (assignment.unplaced.length > 0) {
      const n = assignment.unplaced.length;
      return fail(`Dash left ${n} of ${concepts.length} ${concepts.length === 1 ? 'idea' : 'ideas'} without a topic. Press Try again.`);
    }

    // Draft each topic the map lacks, and keep it approved.
    const madeId = new Map<string, string>();
    for (const fresh of assignment.newTopics) {
      const drafting = collectSpend();
      const result = await draftTopic({
        goal: fresh.name,
        scope: fresh.scope,
        map: await loadMapTopics(client),
        fields,
        anthropicApiKey,
        onSpend: drafting.sink,
      });
      await recordLearnSpend(userId, 'draft-topic', drafting.reports);
      if (!result.ok) return fail(`Dash could not draft ${fresh.name}. ${result.detail}`);

      const embedding = collectSpend();
      const embedded = await embedOne(result.draft.scope, { inputType: 'document', onSpend: embedding.sink });
      await recordLearnSpend(userId, 'embed-topic-scope', embedding.reports);

      const saved = await saveDraft(client, userId, {
        draft: result.draft,
        asked: null,
        embedding: embedded.ok ? { vector: embedded.vector, model: embedded.model } : null,
      });
      await approveDraft(client, saved.id, new Map());
      madeId.set(fresh.name.toLowerCase(), saved.id);
      drafted += 1;
    }

    // Every placement's cell, clamped to the ceiling its topic came back with.
    const topicOf = (p: Placement) => p.topicId ?? madeId.get(p.topicName.toLowerCase()) ?? null;
    const topicIds = [...new Set(assignment.placements.map(topicOf).filter((id): id is string => id !== null))];
    const { data: cellRows, error: cellError } = await client
      .from('topic_cells')
      .select('id, topic_id, level, topic:topics!topic_cells_topic_fk(name, ceiling)')
      .in('topic_id', topicIds);
    if (cellError) throw new Error(cellError.message);
    const cells = (cellRows ?? []) as unknown as {
      id: string;
      topic_id: string;
      level: number;
      topic: { name: string; ceiling: number } | null;
    }[];
    const cellAt = new Map(cells.map((c) => [`${c.topic_id}:${c.level}`, c]));
    const ceilingOf = new Map(cells.map((c) => [c.topic_id, c.topic?.ceiling ?? 10]));
    const nameOf = new Map(cells.map((c) => [c.topic_id, c.topic?.name ?? '']));

    // Steps 1 and 2: seat each concept with its evidence.
    const seats = new Map<string, Seat & { cellId: string }>();
    const unsure: { conceptId: string; cellId: string; why: string }[] = [];
    for (const placement of assignment.placements) {
      const topicId = topicOf(placement);
      if (!topicId) continue;
      const ceiling = ceilingOf.get(topicId) ?? 10;
      const level = Math.min(placement.level, ceiling);
      const cell = cellAt.get(`${topicId}:${level}`);
      if (!cell) continue;
      await seatConcept(client, userId, placement.conceptId, cell, toState(stateOf.get(placement.conceptId)));
      seats.set(placement.conceptId, { topicId, level, cellId: cell.id });
      const why =
        placement.unsure ??
        (level < placement.level
          ? `Dash put it at level ${placement.level}, above where ${nameOf.get(topicId)} stops, so it sits at ${level}.`
          : null);
      if (why) unsure.push({ conceptId: placement.conceptId, cellId: cell.id, why });
    }

    // Step 3: edges to links, and the downward ones to the person.
    const nameOfConcept = new Map(concepts.map((c) => [c.id, c.name]));
    const linked = new Set<string>();
    const edgeReviews: { conceptId: string; prerequisiteId: string; why: string }[] = [];
    for (const edge of (edgeRows.data ?? []) as { prerequisite_id: string; dependent_id: string }[]) {
      const prereq = seats.get(edge.prerequisite_id);
      const dep = seats.get(edge.dependent_id);
      const outcome = edgeOutcome(prereq, dep);
      if (outcome.kind === 'link' && prereq && dep) {
        const pair = `${dep.cellId}:${prereq.cellId}`;
        if (linked.has(pair)) continue;
        linked.add(pair);
        const { error } = await client
          .from('cell_links')
          .upsert(
            { user_id: userId, requiring_cell_id: dep.cellId, required_cell_id: prereq.cellId },
            { onConflict: 'requiring_cell_id,required_cell_id', ignoreDuplicates: true },
          );
        // A link the cycle trigger refuses is left out, as a draft's is.
        if (error) console.error('[learn move] link left out', error.message);
      } else if (outcome.kind === 'review' && prereq && dep) {
        edgeReviews.push({
          conceptId: edge.dependent_id,
          prerequisiteId: edge.prerequisite_id,
          why: downwardWhy(
            nameOfConcept.get(edge.prerequisite_id) ?? 'its prerequisite',
            nameOfConcept.get(edge.dependent_id) ?? 'An idea',
            nameOf.get(prereq.topicId) ?? 'one topic',
            prereq.level,
            dep.level,
          ),
        });
      }
    }

    // What the person answers. A press again replaces the open ones.
    await client.from('move_reviews').delete().eq('subject_id', subjectId).is('decision', null);
    const reviewRows = [
      ...unsure.map((u) => ({
        user_id: userId,
        subject_id: subjectId,
        kind: 'assignment',
        concept_id: u.conceptId,
        cell_id: u.cellId,
        why: u.why,
      })),
      ...edgeReviews.map((e) => ({
        user_id: userId,
        subject_id: subjectId,
        kind: 'edge',
        concept_id: e.conceptId,
        prerequisite_id: e.prerequisiteId,
        why: e.why,
      })),
    ];
    if (reviewRows.length > 0) {
      const { error } = await client.from('move_reviews').insert(reviewRows);
      if (error) throw new Error(`Listing what needs your answer failed: ${error.message}`);
    }

    // Step 4: the subject becomes a lens.
    const lensId = await writeLens(client, userId, subject, lensTargets([...seats.values()]));
    await recordMove(client, userId, subjectId, { status: 'moved', lensId, placed: seats.size, drafted });
    return { ok: true, placed: seats.size, drafted };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Moving the subject failed.');
  }
}

// ---------------------------------------------------------------------------
// Answering a review.
// ---------------------------------------------------------------------------

/**
 * The person's answer to one review.
 *
 * kept: the placement stands, or for an edge the levels stand and the edge
 * is not carried. moved: an assignment moves its concept to `level` of the
 * same topic; an edge moves the prerequisite down to the level of the idea
 * that needs it. A move rewrites the concept's carried evidence at its new
 * level, by the same rule the move used.
 */
export async function settleMoveReview(
  client: Client,
  userId: string,
  input: { id: string; decision: 'kept' | 'moved'; level?: number },
): Promise<void> {
  const { data: review, error } = await client
    .from('move_reviews')
    .select('id, kind, subject_id, concept_id, prerequisite_id, decision')
    .eq('id', input.id)
    .maybeSingle();
  if (error) throw new Error(`Reading that question failed: ${error.message}`);
  if (!review) throw new Error('That question is not one of yours, or it is no longer there.');
  if (review.decision) throw new Error('That one is already answered.');

  if (input.decision === 'moved') {
    const moving: string = review.kind === 'edge' ? review.prerequisite_id : review.concept_id;
    const seats = await seatsOf(client, [review.concept_id, moving]);
    const seat = seats.get(moving);
    if (!seat) throw new Error('That idea is not on a topic any more.');
    const target = review.kind === 'edge' ? seats.get(review.concept_id)?.level : input.level;
    if (!target || target < 1 || target > seat.ceiling) throw new Error(`Pick a level from 1 to ${seat.ceiling}.`);

    const { data: cell, error: cellError } = await client
      .from('topic_cells')
      .select('id, level')
      .eq('topic_id', seat.topicId)
      .eq('level', target)
      .maybeSingle();
    if (cellError || !cell) throw new Error(`Finding level ${target} of ${seat.topicName} failed.`);

    const { data: stateRow } = await client
      .from('concept_state')
      .select('concept_id, state, established, tested_at, declared_at, updated_at')
      .eq('concept_id', moving)
      .maybeSingle();
    await seatConcept(client, userId, moving, cell as { id: string; level: number }, toState((stateRow ?? undefined) as StateRow | undefined));

    const { data: lens } = await client.from('lenses').select('id').eq('subject_id', review.subject_id).maybeSingle();
    if (lens) {
      await writeLens(client, userId, { id: review.subject_id, name: '' }, new Map([[seat.topicId, target]]));
    }
  }

  const { error: writeError } = await client
    .from('move_reviews')
    .update({ decision: input.decision, decided_at: new Date().toISOString() })
    .eq('id', input.id)
    .is('decision', null);
  if (writeError) throw new Error(`Keeping your answer failed: ${writeError.message}`);
}
