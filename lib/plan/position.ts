/**
 * Where a new plan row goes among its siblings.
 *
 * Lived inside the plan page's own add action while the page was the only way
 * to write a step. Telling Dash to add one in a comment is a second way in, and
 * the `.is(null)` rule below is the kind of thing that is right in one copy and
 * quietly wrong in the other -- so it lives here and both callers use it.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleId } from '@/lib/modules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * The end of a sibling list.
 *
 * A new step goes after its siblings rather than among them: the plan is
 * read top to bottom, a new step is almost always the next thing rather than
 * a forgotten early one, and anything else can be moved once it exists.
 * Positions are spaced by ten so that one can later be slotted between two
 * others without renumbering the rest.
 *
 * Siblings are the steps under the same parent, or -- at the top of a module
 * -- the module's other top-level steps. `.is(null)` rather than `.eq('')`
 * for the app-wide module: matching null against the empty string would find
 * nothing and restart the numbering at 10 on every add.
 */
export async function nextPlanPosition(
  supabase: Db,
  userId: string,
  module: ModuleId | null,
  parentId: string | null,
): Promise<number> {
  let query = supabase.from('plan_items').select('position').eq('user_id', userId);
  if (parentId) {
    query = query.eq('parent_id', parentId);
  } else {
    query = query.is('parent_id', null);
    query = module ? query.eq('module', module) : query.is('module', null);
  }
  const { data } = await query.order('position', { ascending: false }).limit(1);
  const last = (data ?? [])[0]?.position as number | undefined;
  return (last ?? 0) + 10;
}
