import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COLUMNS, threadFrom, type DevComment } from '@/lib/comments/load';
import { isModuleId, type ModuleId } from '@/lib/modules';

/**
 * The long-term ideas list.
 *
 * Nothing here is scheduled, assigned or worked, which is the whole
 * distinction from the notes queue next to it: an idea is a thing that might
 * be worth doing one day, and the value of writing it down is only that it
 * stops being carried around in someone's head.
 */

/** Who wrote it. A suggestion is shown apart from the ideas you filed. */
export const IDEA_SOURCES = ['me', 'claude'] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

export function isIdeaSource(value: string): value is IdeaSource {
  return (IDEA_SOURCES as readonly string[]).includes(value);
}

export type IdeaRow = {
  id: string;
  body: string;
  /** The workspace it is about, or null for the app as a whole. */
  module: ModuleId | null;
  createdAt: string;
  /** The plan feature it was shaped into, once it has been. */
  planItem: { id: string; number: number; title: string; status: string } | null;
  source: IdeaSource;
  /** The feature a suggestion came out of, when it came out of one. */
  from: { number: number; title: string } | null;
  /** What has been said about it, oldest first. */
  thread: DevComment[];
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
    // Two foreign keys point at plan_items now, so both joins name theirs.
    .select(
      'id, body, module, created_at, source, ' +
        'plan_item:plan_items!ideas_plan_item_id_fkey(id, number, title, status), ' +
        'from_plan_item:plan_items!ideas_from_plan_item_id_fkey(number, title), ' +
        `thread:dev_comments(${COMMENT_COLUMNS})`,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const scope = row.module as string | null;
    const linked = row.plan_item as Record<string, unknown> | null;
    const origin = row.from_plan_item as Record<string, unknown> | null;
    const source = row.source as string | null;
    return {
      id: row.id as string,
      body: row.body as string,
      // An unknown value reads as yours. The page separates suggestions out,
      // and putting an idea you wrote into that pile is the worse mistake.
      source: source && isIdeaSource(source) ? source : 'me',
      from: origin ? { number: Number(origin.number), title: String(origin.title) } : null,
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
      thread: threadFrom(row.thread),
    };
  });
}
