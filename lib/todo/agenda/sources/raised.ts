import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Questions Dash has raised and you have not answered, from
 * public.raised_items (plan #1473): the open raises on the Dash tab, and the
 * flags a goals run raised on a goal. An open raise is on you; once you answer
 * it the move is Dash's, and it leaves this list the same moment it leaves
 * "Waiting on you" there.
 *
 * Always on, and not completable: a raise is answered where it stands, on the
 * Dash tab or its goal, because the answer is words and a yes does what the
 * raise names. "Later" and "Not this one" go in the dismissal overlay.
 *
 * Read under the Todo workspace rather than Dev, since a raise can be about any
 * workspace and a goal's flag has nothing to do with the build plan.
 */

const PREFIX = 'raised:';

export interface RaisedRowIn {
  id: string;
  title: string;
  ask: string | null;
  goal_id: string | null;
  status: string;
  created_at: string;
}

/** Pure: the agenda items for the open raises. Exported for tests. */
export function raisedItems(rows: readonly RaisedRowIn[]): AgendaItem[] {
  return rows
    .filter((row) => row.status === 'open')
    .map((row) => ({
      key: `${PREFIX}${row.id}`,
      source: 'raised',
      ref: `public.raised_items:${row.id}`,
      title: row.title.trim() || 'A question from Dash',
      day: null,
      onYouSince: row.created_at,
      at: null,
      link: row.goal_id
        ? { href: `/goals/${row.goal_id}`, label: 'The goal' }
        : { href: `/dev/inbox#raise-${row.id}`, label: 'Dash' },
      action: null,
      detail: row.ask?.trim() || null,
      completable: false,
    }));
}

export const raisedSource: AgendaSource = {
  id: 'raised',
  label: 'Questions Dash raised',
  module: 'todo',
  alwaysOn: true,
  description: 'Questions Dash has raised for you and you have not answered yet.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await (ctx.clients ?? sessionClients).shopping();
    const { data, error } = await supabase
      .from('raised_items')
      .select('id, title, ask, goal_id, status, created_at')
      .eq('user_id', ctx.userId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(`Could not read the raised questions: ${error.message}`);
    return raisedItems((data ?? []) as RaisedRowIn[]);
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'raised_item', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'raised_item', key, null);
  },
};
