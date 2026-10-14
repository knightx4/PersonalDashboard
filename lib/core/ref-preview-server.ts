import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AskDb } from '@/lib/ask/db';
import type { Move } from '@/lib/core/move';
import { parsePlanKey, type RefPreview } from '@/lib/core/ref-preview';
import { NO_LONGER_THERE, parseRef, readRowsWith, refTitles, toRef } from '@/lib/core/refs';
import { stepRef } from '@/lib/plan/ref';
import { findPlanRow, loadPlanRowMove, type PlanRowPlace } from '@/lib/plan/row-move';
import { taskMove } from '@/lib/todo/tasks/move';

/**
 * The preview a ref link shows (plan #1931.4): the row's title line from
 * `refTitles`, and its move from its workspace's own move function, where
 * the workspace has one that the row alone can answer. A row from a
 * workspace with none previews with its title only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type PreviewContext = { db: AskDb; supabase: Db; userId: string };

type MoveReader = (
  ctx: PreviewContext,
  id: string,
  place: PlanRowPlace | null,
) => Promise<{ move: Move | null; title?: string } | null>;

/** Each workspace's move, by the table of the row it is asked about. */
const MOVES: Record<string, MoveReader> = {
  'public.plan_items': async (ctx, id, place) => {
    const row = place ?? (await findPlanRow(ctx.supabase, ctx.userId, { id }));
    return row ? loadPlanRowMove(ctx.supabase, ctx.userId, row) : null;
  },
  'todo.tasks': async (ctx, id) => {
    const client = await ctx.db('todo');
    const { data } = await client.from('tasks').select('status').eq('id', id).maybeSingle();
    return data ? taskMove(data as { status: 'open' }) : null;
  },
};

const GONE: RefPreview = { title: NO_LONGER_THERE, missing: true, move: null };

export async function loadRefPreview(key: string, ctx: PreviewContext): Promise<RefPreview> {
  // A step written as a number or an outline is read back to its row first.
  const plan = parsePlanKey(key);
  let place: PlanRowPlace | null = null;
  let ref = key;
  if (plan) {
    place = await findPlanRow(ctx.supabase, ctx.userId, plan);
    if (!place) return GONE;
    ref = toRef('public.plan_items', place.id);
  }

  const parsed = parseRef(ref);
  if (!parsed) return GONE;
  const reader = MOVES[parsed.table];
  const [target, move] = await Promise.all([
    refTitles([ref], readRowsWith(ctx.db)).then((titles) => titles.get(ref)),
    // A move that cannot be read leaves the preview with its title alone.
    reader ? reader(ctx, parsed.id, place).catch(() => null) : Promise.resolve(null),
  ]);
  if (!target || target.missing) return GONE;
  return {
    title: target.title,
    missing: false,
    move: move?.move ?? null,
    ...(move?.title ? { moveTitle: move.title } : {}),
    ...(place ? { label: stepRef(place) } : {}),
  };
}
