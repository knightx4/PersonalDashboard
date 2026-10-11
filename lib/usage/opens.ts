import type { SupabaseClient } from '@supabase/supabase-js';
import { moduleForPath, type ModuleId } from '@/lib/modules';
import { PAGE_ROUTES } from '@/lib/usage/pages';
import { routePattern } from '@/lib/usage/page-view';

/**
 * How often each page has been opened, from core.page_opens (plan #1481), for
 * the Usage tab in Dev and the weekly vision review.
 */

export type PageOpens = {
  route: string;
  workspace: ModuleId | null;
  opens7: number;
  opens30: number;
  /** ISO time, or null for a page never opened. */
  lastOpened: string | null;
};

type Row = {
  route: string;
  workspace: string | null;
  opens_7: number;
  opens_30: number;
  last_opened: string | null;
};

/**
 * The opens of every page that has been opened at least once. Pass the
 * request's own client and the view's RLS keeps it to the signed-in person;
 * a service-role caller passes userId.
 */
export async function readPageOpens(client: SupabaseClient, userId?: string): Promise<PageOpens[]> {
  let query = client.schema('core').from('page_opens').select('route, workspace, opens_7, opens_30, last_opened');
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the page opens: ${error.message}`);
  return ((data ?? []) as Row[]).map((row) => ({
    route: row.route,
    workspace: (row.workspace as ModuleId | null) ?? moduleForPath(row.route),
    opens7: row.opens_7,
    opens30: row.opens_30,
    lastOpened: row.last_opened,
  }));
}

/**
 * Every page in the app with its opens, including the ones never opened, the
 * pages not opened in the last 30 days first (longest unopened at the top),
 * then the rest by opens in 30 days. A route recorded that is no longer a
 * page is dropped.
 */
export function pageUsage(opened: readonly PageOpens[]): PageOpens[] {
  const byRoute = new Map(opened.map((row) => [row.route, row]));
  const all = PAGE_ROUTES.map(
    (route): PageOpens =>
      byRoute.get(route) ?? { route, workspace: moduleForPath(route), opens7: 0, opens30: 0, lastOpened: null },
  );
  return all.sort((a, b) => {
    const aIdle = a.opens30 === 0;
    const bIdle = b.opens30 === 0;
    if (aIdle !== bIdle) return aIdle ? -1 : 1;
    if (aIdle) {
      // Never opened before opened long ago; then the older the earlier.
      if (a.lastOpened !== b.lastOpened) {
        if (a.lastOpened === null) return -1;
        if (b.lastOpened === null) return 1;
        return a.lastOpened < b.lastOpened ? -1 : 1;
      }
      return a.route.localeCompare(b.route);
    }
    return b.opens30 - a.opens30 || a.route.localeCompare(b.route);
  });
}

/**
 * How often the page a path opens was opened in the last 30 days, read from
 * core.page_opens by its route pattern: a note written on `/learn/s/6f1c…`
 * counts the opens of `/learn/s/[id]`, every session's together. 0 for a page
 * never opened, null when the path is not one of the app's pages or the read
 * fails. Note triage reads it to tell a busy page (plan #1643).
 */
export async function readPathOpens30(
  client: SupabaseClient,
  userId: string,
  path: string,
): Promise<number | null> {
  const route = routePattern(path.split(/[?#]/)[0]);
  if (!route) return null;
  const { data, error } = await client
    .schema('core')
    .from('page_opens')
    .select('opens_30')
    .eq('user_id', userId)
    .eq('route', route)
    .maybeSingle();
  if (error) {
    console.warn(`[opens] could not read the opens of ${route}: ${error.message}`);
    return null;
  }
  return (data as { opens_30: number } | null)?.opens_30 ?? 0;
}
