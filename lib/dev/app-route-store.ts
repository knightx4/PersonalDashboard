import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import type { AppRouteStore } from '@/lib/dev/app-route';

/**
 * The run log of lib/dev/app-route.ts in public.app_route_runs, written
 * through the functions of migration 0315 with the service role. Each
 * function scopes its rows to core.dev_owner_id().
 */
export function appRouteRunStore(): AppRouteStore {
  const db = createServiceSupabase();
  return {
    async start({ askedBy, path, query, limit, staleMinutes }) {
      const { data, error } = await db.rpc('start_app_route_run', {
        p_asked_by: askedBy,
        p_path: path,
        p_query: query,
        p_limit: limit,
        p_stale_minutes: staleMinutes,
      });
      if (error) throw new Error(`Could not open the run's log row: ${error.message}`);
      return (data as string | null) ?? null;
    },
    async finish({ id, status, httpStatus, result, resultBytes, error }) {
      const { error: dbError } = await db.rpc('finish_app_route_run', {
        p_id: id,
        p_status: status,
        p_http_status: httpStatus,
        p_result: result,
        p_result_bytes: resultBytes,
        p_error: error,
      });
      if (dbError) throw new Error(`Could not close the run's log row: ${dbError.message}`);
    },
    async refuse({ askedBy, path, query, error }) {
      const { data, error: dbError } = await db.rpc('refuse_app_route_run', {
        p_asked_by: askedBy,
        p_path: path,
        p_query: query,
        p_error: error,
      });
      if (dbError) throw new Error(`Could not log the refused run: ${dbError.message}`);
      return (data as string | null) ?? null;
    },
  };
}
