import 'server-only';

import { createClient } from '@/lib/auth/server';
import { dismiss, undismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Return windows about to close, from public.orders.
 *
 * The one source that genuinely needs the dismissal overlay. A return deadline
 * is a **date derived by `sync_order_state()`**, not a row of its own and not
 * something with a completed flag -- it stops mattering when the return exists
 * or the day passes, and neither of those is a button. So there is nowhere in
 * the commerce schema to record "I have seen this one", and
 * `todo.dismissals` is where that goes.
 *
 * Which is also why these items are not completable. Offering a checkbox that
 * changed nothing on the order would be a lie about what the click did.
 */

type Row = Record<string, unknown>;

function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

/** Orders whose return question is already settled, one way or the other. */
const SETTLED = ['returned', 'cancelled'];

export const returnDeadlinesSource: AgendaSource = {
  id: 'return_deadlines',
  label: 'Return deadlines',
  module: 'shopping',
  description: 'Return windows about to close on things you have not sent back.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('orders')
      .select('id, return_deadline, external_order_number, status, merchants ( name )')
      .eq('user_id', ctx.userId)
      .not('return_deadline', 'is', null)
      .not('status', 'in', `(${SETTLED.join(',')})`)
      .is('deleted_at', null)
      // A deadline is a DATE column, so it is compared against days rather
      // than instants -- converting it through a zone is exactly the mistake
      // the todo module's own two due columns exist to prevent.
      .gte('return_deadline', ctx.from)
      .lte('return_deadline', ctx.to)
      .order('return_deadline', { ascending: true })
      .limit(100);

    if (error) throw new Error(error.message);

    return ((data ?? []) as Row[]).map((row) => {
      const merchant = one(row.merchants);
      const name = (merchant?.name as string) ?? 'an order';
      const number = row.external_order_number as string | null;

      return {
        key: `return_deadlines:${row.id as string}`,
        source: 'return_deadlines',
        title: `Return window closes — ${name}`,
        day: row.return_deadline as string,
        at: null,
        link: { href: `/shopping/orders/${row.id as string}`, label: 'Open the order' },
        action: { href: '/shopping/returns', label: 'Returns' },
        detail: number ? `#${number}` : null,
        // A date is not a task. See the note at the top of this file.
        completable: false,
      };
    });
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'return_deadline', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'return_deadline', key, null);
  },
};

/** Exported for the undo path, and so the enum value has exactly one owner. */
export async function undismissReturnDeadline(userId: string, key: string): Promise<void> {
  await undismiss(userId, 'return_deadline', key);
}
