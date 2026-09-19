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
  /** When it was put aside. Null while it is live. */
  dismissedAt: string | null;
  /** What has been said about it, oldest first. */
  thread: DevComment[];
};

/**
 * The four piles the page draws.
 *
 * Your own ideas are the list; a suggestion sits under them so that a session
 * writing five follow-ons in a night cannot bury the two thoughts you had.
 * Shaped and dismissed ideas are both behind a fold: one has become a plan
 * feature, the other you said no to, and neither is something to read past on
 * the way to the live list.
 */
export interface IdeaList {
  mine: IdeaRow[];
  suggested: IdeaRow[];
  shaped: IdeaRow[];
  dismissed: IdeaRow[];
}

/** Every column the app reads off an idea, and the two plan items it points at. */
export const IDEA_COLUMNS =
  'id, body, module, created_at, source, dismissed_at, ' +
  // Two foreign keys point at plan_items, so both joins name theirs.
  'plan_item:plan_items!ideas_plan_item_id_fkey(id, number, title, status), ' +
  'from_plan_item:plan_items!ideas_from_plan_item_id_fkey(number, title), ' +
  `thread:dev_comments(${COMMENT_COLUMNS})`;

/** A row as the app reads it. One shape leaves here, whoever selected it. */
export function ideaRowFrom(row: Record<string, unknown>): IdeaRow {
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
    dismissedAt: (row.dismissed_at as string | null) ?? null,
    thread: threadFrom(row.thread),
  };
}

/**
 * Dismissed first, because a dismissed idea is out of the page whatever else
 * is true of it: that is what dismissing it was for.
 */
export function ideaListFrom(rows: readonly IdeaRow[]): IdeaList {
  const dismissed = rows.filter((idea) => idea.dismissedAt);
  const live = rows.filter((idea) => !idea.dismissedAt);
  const open = live.filter((idea) => !idea.planItem);

  return {
    mine: open.filter((idea) => idea.source === 'me'),
    suggested: open.filter((idea) => idea.source === 'claude'),
    shaped: live.filter((idea) => idea.planItem),
    dismissed,
  };
}

/**
 * The suggestions you turned down that came out of one feature.
 *
 * Read when that feature is re-read, and nowhere else. Without it a session
 * writes the same follow-on again -- it is reading the same code and reaching
 * the same thought -- and the page fills with things you have already said no
 * to. The body is all the turn needs: it is there to be recognised, not
 * followed.
 */
export async function loadDismissedSuggestions(
  supabase: SupabaseClient,
  userId: string,
  planItemId: string,
): Promise<Array<{ id: string; body: string }>> {
  const { data } = await supabase
    .from('ideas')
    .select('id, body')
    .eq('user_id', userId)
    .eq('from_plan_item_id', planItemId)
    .not('dismissed_at', 'is', null)
    .order('created_at', { ascending: false });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    body: row.body as string,
  }));
}

/**
 * The ideas a new one is checked against before it is written.
 *
 * Body and id only, which is all lib/ideas/duplicate.ts compares and all a
 * refusal names. The set is what is open on the page: a shaped idea is in the
 * plan and a dismissed one was put aside, and neither is a row anything would
 * be adding to.
 *
 * The same set `scripts/plan.ts idea` selects by hand. #647 is the step that
 * brings that query here and takes the dismissed filter off both at once, so
 * that a suggestion you put aside is not filed again -- #646 answered A.
 * Until then this reads what the script reads.
 */
export async function loadFiledIdeas(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ id: string; body: string }>> {
  const { data, error } = await supabase
    .from('ideas')
    .select('id, body')
    .eq('user_id', userId)
    .is('plan_item_id', null)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    body: row.body as string,
  }));
}

/**
 * Newest first: the reason to open this page is usually the thought you had
 * last week, not the one you had in March.
 */
export async function loadIdeas(supabase: SupabaseClient, userId: string): Promise<IdeaList> {
  const { data } = await supabase
    .from('ideas')
    .select(IDEA_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  // Through `unknown`: the column list is built as an expression, so the
  // client cannot infer a row shape from it and types the result as its
  // error case instead.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  return ideaListFrom(rows.map(ideaRowFrom));
}
