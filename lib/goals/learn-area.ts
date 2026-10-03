import 'server-only';

import { createGoalsClient } from '@/lib/goals/auth/server';

/**
 * Where the learning goals are on /goals (plan #1491): the person's Learn
 * area, which goals 0066 makes the first time they have a learning goal. Its
 * page is /goals/area/<id>. Without one, or when it cannot be read, /goals,
 * where adding a goal to a new Learn area starts.
 */
export const GOALS_HOME = '/goals';

export function learnAreaPath(areaId: string | null): string {
  return areaId ? `/goals/area/${areaId}` : GOALS_HOME;
}

/** The Learn area's page for the signed-in person. Never throws. */
export async function loadLearnAreaHref(): Promise<string> {
  try {
    const client = await createGoalsClient();
    const { data, error } = await client
      .from('areas')
      .select('id')
      .eq('learn', true)
      .is('archived_at', null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return learnAreaPath((data as { id: string } | null)?.id ?? null);
  } catch (error) {
    console.error('[learn area]', error instanceof Error ? error.message : error);
    return GOALS_HOME;
  }
}
