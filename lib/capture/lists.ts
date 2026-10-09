import type { SchemaClient } from '@/lib/ask/db';
import type { CapturePlace, CaptureSortGoal, CaptureSortRole } from '@/lib/capture/sort';

/**
 * The goals and roles the capture sorter is shown (plan #1581), read for one
 * account. Shared by the capture box (app/capture-actions.ts), on the
 * person's session, and the capture address (lib/capture/address-server.ts,
 * plan #1706), on the service-role client. Every query filters by user_id,
 * which on the service-role client is the only thing saying whose rows these
 * are.
 */

/** The most goals or roles the sorter is shown. */
export const CAPTURE_LIST_MAX = 40;

type RoleJoin = { id: string; title: string; companies: { name: string } | null } | null;

/** Their open goals and the roles of their open applications, newest first; empty where a read fails. */
export async function loadCaptureSortLists(
  userId: string,
  places: readonly CapturePlace[],
  clients: { goals: () => Promise<SchemaClient>; jobs: () => Promise<SchemaClient> },
): Promise<{ goals: CaptureSortGoal[]; roles: CaptureSortRole[] }> {
  let goals: CaptureSortGoal[] = [];
  const roles: CaptureSortRole[] = [];
  if (places.includes('goals')) {
    try {
      const client = await clients.goals();
      const { data } = await client
        .from('items')
        .select('id, title')
        .eq('user_id', userId)
        .eq('level', 'goal')
        .eq('status', 'open')
        .is('archived_at', null)
        .order('position')
        .limit(CAPTURE_LIST_MAX);
      goals = ((data ?? []) as { id: string; title: string }[]).map((g) => ({ id: g.id, title: g.title }));
    } catch (error) {
      console.error('capture: could not read goals', error);
    }
  }
  if (places.includes('jobs')) {
    try {
      const client = await clients.jobs();
      const { data } = await client
        .from('applications')
        .select('updated_at, roles ( id, title, companies ( name ) )')
        .eq('user_id', userId)
        .is('closed_at', null)
        .order('updated_at', { ascending: false })
        .limit(CAPTURE_LIST_MAX);
      const seen = new Set<string>();
      for (const row of (data ?? []) as unknown as { roles: RoleJoin }[]) {
        const role = row.roles;
        if (!role || seen.has(role.id)) continue;
        seen.add(role.id);
        roles.push({ id: role.id, title: role.title, company: role.companies?.name ?? null });
      }
    } catch (error) {
      console.error('capture: could not read roles', error);
      roles.length = 0;
    }
  }
  return { goals, roles };
}
