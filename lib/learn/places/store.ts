import 'server-only';

import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { parseVector } from '@/lib/learn/map/load';
import type { LearnOperation } from '@/lib/learn/spend';
import { clusterPlaces } from './cluster';
import { namePlaces, PLACES_PER_CALL, type PlaceToName } from './name';
import { membershipChange, reconcilePlaces, type StoredPlace } from './reconcile';

/**
 * Working out one person's places again (plan #1997.2), as a stage of the
 * daily run after the day's ideas have their embeddings.
 *
 * Clusters every embedded idea (cluster.ts), carries over the places that
 * came back (reconcile.ts), names the new ones and those whose ideas changed
 * by more than a third (name.ts), and writes the result to learn.idea_places
 * and learn.idea_place_members.
 *
 * The writes are not one transaction, so they are ordered for a run that
 * dies halfway to leave something the next run corrects: new places first,
 * then every grouped idea moved to its place, then the ideas in none taken
 * out, then the places that did not come back removed, then the names.
 *
 * Without an Anthropic key, or when the naming call fails, the places are
 * still written. A new place is left with no name and a renamed one keeps
 * its old name, and both are tried again the next day.
 */

const NAME_PLACES_OPERATION: LearnOperation = 'name-places';

/** Ids per `in` filter, to keep the request line short. */
const IDS_PER_FILTER = 100;

export type RecomputePlacesResult = {
  ideas: number;
  places: number;
  grouped: number;
  ungrouped: number;
  added: number;
  removed: number;
  named: number;
  /** Places that needed a name and did not get one this run. */
  unnamed: number;
  /** Why the naming call gave nothing, when it did not. */
  namingError?: string;
};

type ConceptRow = { id: string; name: string; claim: string; embedding: string | number[] | null };
type PlaceRow = { id: string; name: string | null; named_members: string[] | null };
type MemberRow = { concept_id: string; place_id: string };

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function ledger(learn: LearnSupabaseClient, userId: string, reports: SpendReport[]): Promise<void> {
  if (reports.length === 0) return;
  try {
    const core = learn.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;
    for (const report of reports) {
      await recordSpend(core, userId, {
        module: 'learn',
        operation: NAME_PLACES_OPERATION,
        model: report.model,
        usage: report.usage,
      });
    }
  } catch (error) {
    console.error('[learn places] recording what naming cost', error instanceof Error ? error.message : error);
  }
}

export async function recomputePlaces(
  learn: LearnSupabaseClient,
  userId: string,
  options: { anthropicApiKey?: string; client?: Anthropic } = {},
): Promise<RecomputePlacesResult> {
  const [concepts, storedRows, memberRows] = await Promise.all([
    readAll<ConceptRow>((from, to) =>
      learn.from('concepts').select('id, name, claim, embedding').eq('user_id', userId).order('id').range(from, to),
    ),
    readAll<PlaceRow>((from, to) =>
      learn.from('idea_places').select('id, name, named_members').eq('user_id', userId).order('id').range(from, to),
    ),
    readAll<MemberRow>((from, to) =>
      learn
        .from('idea_place_members')
        .select('concept_id, place_id')
        .eq('user_id', userId)
        .order('concept_id')
        .range(from, to),
    ),
  ]);

  const ideas: { id: string; vector: number[] }[] = [];
  for (const row of concepts) {
    const vector = parseVector(row.embedding);
    if (vector) ideas.push({ id: row.id, vector });
  }
  const clustering = clusterPlaces(ideas);

  const membersOf = new Map<string, string[]>(storedRows.map((row) => [row.id, []]));
  for (const member of memberRows) membersOf.get(member.place_id)?.push(member.concept_id);
  const stored: StoredPlace[] = storedRows.map((row) => ({
    id: row.id,
    name: row.name,
    namedMembers: row.named_members ?? [],
    members: membersOf.get(row.id) ?? [],
  }));
  const plan = reconcilePlaces(stored, clustering.places);

  // Names: every new place, and every kept one that needs one.
  const conceptOf = new Map(concepts.map((row) => [row.id, row]));
  const addedIds = plan.added.map(() => randomUUID());
  const toName: (PlaceToName & { members: string[] })[] = [
    ...plan.kept.filter((place) => place.needsName).map((place) => ({ key: place.id, members: place.members })),
    ...plan.added.map((members, i) => ({ key: addedIds[i]!, members })),
  ].map(({ key, members }) => ({
    key,
    members,
    ideas: members.map((id) => conceptOf.get(id)!).map((row) => ({ name: row.name, claim: row.claim })),
  }));
  const storedOf = new Map(stored.map((place) => [place.id, place]));
  const inUse = plan.kept
    .filter((place) => !place.needsName)
    .map((place) => storedOf.get(place.id)?.name)
    .filter((name): name is string => !!name);

  const names = new Map<string, string>();
  let namingError: string | undefined;
  if (toName.length > 0 && options.anthropicApiKey) {
    const reports: SpendReport[] = [];
    try {
      for (const batch of chunks(toName, PLACES_PER_CALL)) {
        const result = await namePlaces({
          places: batch,
          inUse: [...inUse, ...names.values()],
          anthropicApiKey: options.anthropicApiKey,
          client: options.client,
          onSpend: (report) => reports.push(report),
        });
        if (!result.ok) {
          namingError = result.detail;
          break;
        }
        for (const [key, name] of result.names) names.set(key, name);
      }
    } finally {
      await ledger(learn, userId, reports);
    }
  } else if (toName.length > 0) {
    namingError = 'No Anthropic key, so the places were left unnamed.';
  }
  const now = new Date().toISOString();

  // 1. New places.
  if (plan.added.length > 0) {
    const rows = plan.added.map((members, i) => {
      const name = names.get(addedIds[i]!) ?? null;
      return {
        id: addedIds[i]!,
        user_id: userId,
        name,
        named_members: name ? members : [],
        named_at: name ? now : null,
        member_count: members.length,
      };
    });
    const { error } = await learn.from('idea_places').insert(rows);
    if (error) throw new Error(`Adding places failed: ${error.message}`);
  }

  // 2. Every grouped idea in its place.
  const placeOfIdea = new Map<string, string>();
  plan.kept.forEach((place) => place.members.forEach((id) => placeOfIdea.set(id, place.id)));
  plan.added.forEach((members, i) => members.forEach((id) => placeOfIdea.set(id, addedIds[i]!)));
  const current = new Map(memberRows.map((row) => [row.concept_id, row.place_id]));
  const moved = [...placeOfIdea].filter(([id, place]) => current.get(id) !== place);
  for (const batch of chunks(moved, 500)) {
    const { error } = await learn
      .from('idea_place_members')
      .upsert(
        batch.map(([concept_id, place_id]) => ({ concept_id, place_id, user_id: userId })),
        { onConflict: 'concept_id' },
      );
    if (error) throw new Error(`Placing ideas failed: ${error.message}`);
  }

  // 3. Ideas in no place, including any that lost their embedding.
  const leaving = memberRows.map((row) => row.concept_id).filter((id) => !placeOfIdea.has(id));
  for (const batch of chunks(leaving, IDS_PER_FILTER)) {
    const { error } = await learn.from('idea_place_members').delete().eq('user_id', userId).in('concept_id', batch);
    if (error) throw new Error(`Taking ideas out of places failed: ${error.message}`);
  }

  // 4. Places that did not come back.
  for (const batch of chunks(plan.removed, IDS_PER_FILTER)) {
    const { error } = await learn.from('idea_places').delete().eq('user_id', userId).in('id', batch);
    if (error) throw new Error(`Removing places failed: ${error.message}`);
  }

  // 5. Kept places whose ideas or name changed.
  for (const place of plan.kept) {
    const before = storedOf.get(place.id)!;
    const name = place.needsName ? names.get(place.id) : undefined;
    if (!name && membershipChange(before.members, place.members) === 0) continue;
    const update: Record<string, unknown> = { member_count: place.members.length, updated_at: now };
    if (name) Object.assign(update, { name, named_members: place.members, named_at: now });
    const { error } = await learn.from('idea_places').update(update).eq('id', place.id).eq('user_id', userId);
    if (error) throw new Error(`Updating a place failed: ${error.message}`);
  }

  const grouped = clustering.places.reduce((sum, members) => sum + members.length, 0);
  return {
    ideas: ideas.length,
    places: clustering.places.length,
    grouped,
    ungrouped: clustering.ungrouped.length,
    added: plan.added.length,
    removed: plan.removed.length,
    named: names.size,
    unnamed: toName.length - names.size,
    ...(namingError ? { namingError } : {}),
  };
}

/** Every account with at least one idea, one read per account. */
export async function usersWithIdeas(learn: LearnSupabaseClient): Promise<string[]> {
  const users: string[] = [];
  let after: string | null = null;
  for (;;) {
    let query = learn.from('concepts').select('user_id').order('user_id').limit(1);
    if (after) query = query.gt('user_id', after);
    const { data, error } = await query;
    if (error) throw new Error(`Listing accounts with ideas failed: ${error.message}`);
    const next = ((data ?? []) as { user_id: string }[])[0]?.user_id;
    if (!next) return users;
    users.push(next);
    after = next;
  }
}
