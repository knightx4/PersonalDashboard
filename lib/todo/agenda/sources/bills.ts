import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS, todayIn } from '@/lib/todo/tasks/model';
import { formatMoney } from '@/lib/money';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Bills and renewals coming up, from public.recurring_payments (plan #1126).
 *
 * An item rather than day context, so one due within the week reaches the
 * morning brief as return windows do (lib/day-brief/facts.ts). Like a return
 * deadline it is a date, not a task: paying happens elsewhere, so there is no
 * tick, and "Later" and "Not this one" go in the dismissal overlay. The key
 * carries the due date, so dismissing this month's renewal leaves next
 * month's to show.
 *
 * A next date before today is not shown: that is a charge that never came,
 * which the Recurring page lists as possibly lapsed.
 */

type Row = {
  id: string;
  payee: string;
  kind: 'subscription' | 'bill';
  amount_cents: number | null;
  currency: string;
  next_date: string;
};

export function billTitle(row: Pick<Row, 'payee' | 'kind' | 'amount_cents' | 'currency'>): string {
  const amount = row.amount_cents != null ? formatMoney(row.amount_cents, row.currency) : null;
  if (row.kind === 'bill') return amount ? `${row.payee} bill due, ${amount}` : `${row.payee} bill due`;
  return amount ? `${row.payee} renews at ${amount}` : `${row.payee} renews`;
}

export const billsSource: AgendaSource = {
  id: 'bills',
  label: 'Bills and renewals',
  module: 'shopping',
  description: 'Bills due and subscriptions renewing, on the day, with the amount.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await (ctx.clients ?? sessionClients).shopping();
    const today = todayIn(ctx.timezone, ctx.now);
    const from = ctx.from > today ? ctx.from : today;

    const { data, error } = await supabase
      .from('recurring_payments')
      .select('id, payee, kind, amount_cents, currency, next_date')
      .eq('user_id', ctx.userId)
      .eq('status', 'active')
      .gte('next_date', from)
      .lte('next_date', ctx.to)
      .order('next_date', { ascending: true })
      .limit(100);

    if (error) throw new Error(error.message);

    return ((data ?? []) as Row[]).map((row) => ({
      key: `bills:${row.id}:${row.next_date}`,
      source: 'bills',
      title: billTitle(row),
      day: row.next_date,
      at: null,
      link: { href: '/shopping/recurring', label: 'Open Recurring' },
      action: null,
      detail: row.kind === 'bill' ? 'Bill' : 'Subscription',
      completable: false,
    }));
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'recurring_payment', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'recurring_payment', key, null);
  },
};
