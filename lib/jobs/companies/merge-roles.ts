import type { SchemaClient } from '@/lib/ask/db';
import { statusRank, type ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * Folding duplicate roles into one, as the Merge roles button on a company
 * page does and Dash's merge_roles does (plan #2473.6). Both call this, so
 * which application survives and what moves cannot differ between them.
 *
 * The moving is `job_search.merge_roles` (migration 0058), in one
 * transaction, reading which tables to move from the foreign keys. The
 * caller checks the roles are the person's and at one company first, for a
 * message that says why; the function checks again.
 */

export type MergeApplication = { id: string; status: string; created_at: string };

/**
 * The application a merge keeps: the one furthest along, ties broken by
 * whichever is older. Ranking status is lib/jobs/pipeline.ts's job, so it is
 * decided here and handed to the database.
 */
export function keptApplication<T extends MergeApplication>(apps: readonly T[]): T | null {
  if (apps.length === 0) return null;
  return apps.reduce((best, app) => {
    const appRank = statusRank(app.status as ApplicationStatus);
    const bestRank = statusRank(best.status as ApplicationStatus);
    if (appRank !== bestRank) return appRank > bestRank ? app : best;
    return new Date(app.created_at) < new Date(best.created_at) ? app : best;
  });
}

/**
 * Fold `mergedRoleIds` into `keepRoleId`. `applications` are every
 * application on those roles; the one keptApplication picks becomes the
 * role's only one. `jobs` is a client on the job_search schema.
 */
export async function mergeRolesInto(
  jobs: SchemaClient,
  keepRoleId: string,
  mergedRoleIds: readonly string[],
  applications: readonly MergeApplication[],
): Promise<{ keptApplicationId: string | null; error: { message: string; code?: string } | null }> {
  const kept = keptApplication(applications);
  const { error } = await jobs.rpc('merge_roles', {
    p_keep_role: keepRoleId,
    p_merge_roles: [...mergedRoleIds],
    p_keep_application: kept?.id ?? null,
  });
  return { keptApplicationId: kept?.id ?? null, error: error ? { message: error.message, code: error.code } : null };
}
