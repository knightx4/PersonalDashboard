import 'server-only';

import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { EmbedSweepResult } from '@/lib/learn/catalogue/embed-sweep';
import {
  anyIdeaOwner,
  embedFieldsOverRest,
  embedIdeasOverRest,
  fieldsDue,
  usersWithIdeasDue,
} from '@/lib/learn/embed/idea-sweep';
import { refreshWorkEvidence, type WorkEvidenceResult } from '@/lib/learn/evidence/work';
import { refreshVaultDust, type RefreshDustResult } from '@/lib/learn/map/dust-store';
import { recomputePlaces, usersWithIdeas, type RecomputePlacesResult } from '@/lib/learn/places/store';

/**
 * Learn's missing embeddings, as a stage of the daily cron (plan #1854).
 *
 * Fills in the vector of every idea saved without one. Bounded so it shares
 * the cron's five minutes with the other stages: what it cannot reach waits
 * for tomorrow. Then the 47 fields of the area catalogue (plan #1856), once
 * rather than per person since they are shared: `fields` in the result. Their
 * spend goes to the first person swept, or to any person with ideas.
 *
 * Then every person's places on Idea Space are worked out again from the
 * vectors as they now stand (plan #1997.2): `places` in the result. That runs
 * with or without the embedding key, since it only reads stored vectors, and
 * one person's failure is reported without stopping the next. Last, each
 * vault note is matched with the idea it is most like, for the dust behind
 * the map (plan #1997.6): `dust` in the result. Then each person's ideas are
 * linked to the passages of their résumé and Career notes that match them
 * (plan #2006.5): `work` in the result. Résumé passages are embedded only
 * with the key; without it the passages already embedded are still matched.
 */
const BUDGET_MS = 90_000;
/** Ideas per person per run; a first run fills the ~150 missing today. */
const PER_PERSON_LIMIT = 500;

export type LearnEmbeddingsDaily = {
  skipped?: 'no-key';
  users: { userId: string; ideas: EmbedSweepResult }[];
  /** Null when no field was due, or no account had ideas to bill. */
  fields: EmbedSweepResult | null;
  places: { userId: string; result: RecomputePlacesResult | { error: string } }[];
  dust: { userId: string; result: RefreshDustResult | { error: string } }[];
  work: { userId: string; result: WorkEvidenceResult | { error: string } }[];
};

export async function runLearnEmbeddingsDaily(): Promise<LearnEmbeddingsDaily> {
  const learn = createLearnServiceSupabase();
  if (!process.env.EMBEDDING_API_KEY?.trim()) {
    return { skipped: 'no-key', users: [], fields: null, ...(await runMaps(learn, false)) };
  }

  const deadline = Date.now() + BUDGET_MS;
  const users: LearnEmbeddingsDaily['users'] = [];

  for (const userId of await usersWithIdeasDue(learn)) {
    if (Date.now() >= deadline) break;
    const ideas = await embedIdeasOverRest(learn, userId, { deadline, limit: PER_PERSON_LIMIT });
    users.push({ userId, ideas });
  }

  let fields: EmbedSweepResult | null = null;
  if (Date.now() < deadline && (await fieldsDue(learn))) {
    const payer = users[0]?.userId ?? (await anyIdeaOwner(learn));
    if (payer) fields = await embedFieldsOverRest(learn, payer, { deadline });
  }
  return { users, fields, ...(await runMaps(learn, true)) };
}

async function runMaps(
  learn: ReturnType<typeof createLearnServiceSupabase>,
  embed: boolean,
): Promise<Pick<LearnEmbeddingsDaily, 'places' | 'dust' | 'work'>> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  const places: LearnEmbeddingsDaily['places'] = [];
  const dust: LearnEmbeddingsDaily['dust'] = [];
  const work: LearnEmbeddingsDaily['work'] = [];
  const failed = (error: unknown) => ({ error: error instanceof Error ? error.message : 'failed' });
  for (const userId of await usersWithIdeas(learn)) {
    try {
      places.push({ userId, result: await recomputePlaces(learn, userId, { anthropicApiKey }) });
    } catch (error) {
      places.push({ userId, result: failed(error) });
    }
    try {
      dust.push({ userId, result: await refreshVaultDust(learn, userId) });
    } catch (error) {
      dust.push({ userId, result: failed(error) });
    }
    try {
      work.push({ userId, result: await refreshWorkEvidence(learn, userId, { embed }) });
    } catch (error) {
      work.push({ userId, result: failed(error) });
    }
  }
  return { places, dust, work };
}
