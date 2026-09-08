import type { SupabaseClient } from '@supabase/supabase-js';
import { isModuleId, type ModuleId } from '@/lib/modules';

/**
 * The long-term ideas list.
 *
 * Nothing here is scheduled, assigned or worked, which is the whole
 * distinction from the notes queue next to it: an idea is a thing that might
 * be worth doing one day, and the value of writing it down is only that it
 * stops being carried around in someone's head.
 */

export type IdeaRow = {
  id: string;
  body: string;
  /** The workspace it is about, or null for the app as a whole. */
  module: ModuleId | null;
  createdAt: string;
  /** The plan feature it was shaped into, once it has been. */
  planItem: { id: string; number: number; title: string; status: string } | null;
};

/**
 * Newest first: the reason to open this page is usually the thought you had
 * last week, not the one you had in March.
 */
export async function loadIdeas(
  supabase: SupabaseClient,
  userId: string,
): Promise<IdeaRow[]> {
  const { data } = await supabase
    .from('ideas')
    .select('id, body, module, created_at, plan_item:plan_items(id, number, title, status)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const scope = row.module as string | null;
    const linked = row.plan_item as Record<string, unknown> | null;
    return {
      id: row.id as string,
      body: row.body as string,
      planItem: linked
        ? {
            id: String(linked.id),
            number: Number(linked.number),
            title: String(linked.title),
            status: String(linked.status),
          }
        : null,
      // A module removed from lib/modules leaves a harmless string in the
      // column; it reads back as "the whole app" rather than as a workspace
      // nothing can look up.
      module: scope && isModuleId(scope) ? scope : null,
      createdAt: row.created_at as string,
    };
  });
}
