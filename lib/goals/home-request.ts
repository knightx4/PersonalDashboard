import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/auth/server';
import { createGoalsClient } from './auth/server';
import { loadHome } from './home-store';

/** The clock, outside the cached function so the cache key stays the two strings. */
function readClock(): number {
  return Date.now();
}

/**
 * The Goals home's reads, once per request. The layout counts the Inbox badge
 * from them and the Home and Inbox pages draw from them, so a visit to either
 * page reads the tree once rather than twice.
 */
export const loadHomeForRequest = cache(async (userId: string, today: string) => {
  const [client, supabase] = await Promise.all([createGoalsClient(), createClient()]);
  return loadHome(client, supabase, { userId, today, now: readClock() });
});
