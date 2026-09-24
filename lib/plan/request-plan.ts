import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/auth/server';
import { loadPlan, type PlanData } from './load';

/**
 * The plan, read once per request however many parts of the page ask for it.
 *
 * The dev layout reads the whole plan for its "waiting on you" count, and Dash
 * read it again for its own sections, so every open of Dash fetched every plan
 * row and its thread twice. `cache` hands the second caller the first one's
 * promise. It is keyed by the user alone, because the layout and the page each
 * make their own client and a key on the client would never match.
 *
 * Only for readers that do not write to the plan first. The plan page syncs
 * from the seed and ends quiet runs before it reads, and a copy taken before
 * those writes would miss them, so it keeps calling `loadPlan` itself.
 */
export const loadPlanForRequest = cache(async (userId: string): Promise<PlanData> => {
  const supabase = await createClient();
  return loadPlan(supabase, userId);
});
