import 'server-only';

import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { EmbedSweepResult } from '@/lib/learn/catalogue/embed-sweep';
import { embedIdeasOverRest, usersWithIdeasDue } from '@/lib/learn/embed/idea-sweep';

/**
 * Learn's missing embeddings, as a stage of the daily cron (plan #1854).
 *
 * Fills in the vector of every idea saved without one. Bounded so it shares
 * the cron's five minutes with the other stages: what it cannot reach waits
 * for tomorrow. Plan #1856 adds the fields as a second sweep per person,
 * after the ideas, and a field of the result beside `ideas`.
 */
const BUDGET_MS = 90_000;
/** Ideas per person per run; a first run fills the ~150 missing today. */
const PER_PERSON_LIMIT = 500;

export type LearnEmbeddingsDaily = {
  skipped?: 'no-key';
  users: { userId: string; ideas: EmbedSweepResult }[];
};

export async function runLearnEmbeddingsDaily(): Promise<LearnEmbeddingsDaily> {
  if (!process.env.EMBEDDING_API_KEY?.trim()) return { skipped: 'no-key', users: [] };

  const learn = createLearnServiceSupabase();
  const deadline = Date.now() + BUDGET_MS;
  const users: LearnEmbeddingsDaily['users'] = [];

  for (const userId of await usersWithIdeasDue(learn)) {
    if (Date.now() >= deadline) break;
    const ideas = await embedIdeasOverRest(learn, userId, { deadline, limit: PER_PERSON_LIMIT });
    users.push({ userId, ideas });
  }
  return { users };
}
