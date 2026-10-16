import 'server-only';

import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { EmbedSweepResult } from '@/lib/learn/catalogue/embed-sweep';
import { embedIdeasOverRest, usersWithIdeasDue } from '@/lib/learn/embed/idea-sweep';

/**
 * The idea sweep's own run (plan #2147.1).
 *
 * Saving an idea embeds its claim as it goes and only logs when the call
 * fails, and the daily stage that used to be the only catch-up shared five
 * minutes with Idea Space and note evidence, so it fell behind. This runs on
 * its own clock (supabase/migrations/0248_idea_embeddings_tick_cron.sql) and
 * keeps going until no idea is due or the budget is spent, so an idea saved
 * without a vector has one within the tick.
 */
export const IDEA_EMBEDDINGS_BUDGET_MS = 240_000;

export type IdeaEmbeddingsTick = {
  skipped?: 'no-key';
  users: { userId: string; ideas: EmbedSweepResult }[];
  /** True when the run stopped with ideas still due; the next tick carries on. */
  more: boolean;
};

export async function runIdeaEmbeddingsTick(): Promise<IdeaEmbeddingsTick> {
  if (!process.env.EMBEDDING_API_KEY?.trim()) return { skipped: 'no-key', users: [], more: false };
  const learn = createLearnServiceSupabase();
  const deadline = Date.now() + IDEA_EMBEDDINGS_BUDGET_MS;
  const users: IdeaEmbeddingsTick['users'] = [];
  const failed = new Set<string>();

  // A person whose sweep stopped on an error is not asked again this run, so
  // a refused call cannot spin the loop.
  for (;;) {
    const due = (await usersWithIdeasDue(learn)).filter((id) => !failed.has(id));
    if (due.length === 0 || Date.now() >= deadline) break;
    for (const userId of due) {
      if (Date.now() >= deadline) break;
      const ideas = await embedIdeasOverRest(learn, userId, { deadline });
      users.push({ userId, ideas });
      if (ideas.stopped) failed.add(userId);
    }
  }
  const more = (await usersWithIdeasDue(learn)).some((id) => !failed.has(id));
  return { users, more };
}
