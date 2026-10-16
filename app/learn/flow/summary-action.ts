'use server';

import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadRunSummary } from '@/lib/learn/flow/summary-store';
import type { RunSummary } from '@/lib/learn/flow/summary';

/**
 * What the last hour of answers moved (plan #2164.6), for the card that ends
 * a Practice Flow run and today's piece. Reads stored answers and nothing
 * else: no model, no write.
 */

export type SummaryResult = { summary: RunSummary | null; error?: string };

// latency: pending
export async function readRunSummary(): Promise<SummaryResult> {
  try {
    const user = await requireUser();
    return { summary: await loadRunSummary(await createLearnClient(), user.id) };
  } catch (error) {
    return { summary: null, error: error instanceof Error ? error.message : 'Could not read your answers.' };
  }
}
