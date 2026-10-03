import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { todayIn } from '@/lib/todo/tasks/model';
import type {
  AgendaItem,
  AgendaSource,
  DayContext,
  SourceContext,
} from '@/lib/todo/agenda/sources';

/**
 * Parcels on their way, from public.shipments (plan #1127).
 *
 * Day context, like an interview: a parcel arriving is something the day
 * holds, and there is nothing to tick. It shows on the day its shipping mail
 * said it would come (`expected_on`, read by lib/email/extract/lifecycle.ts)
 * and goes once the shipment is marked delivered. A shipment whose mail named
 * no day is not shown: a guess at the day would be a guess on the page.
 */

type Row = Record<string, unknown>;

function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

/** Shipments still coming. Delivered and failed ones are not on the way. */
const COMING = ['pending', 'in_transit', 'out_for_delivery'];

export const deliveriesSource: AgendaSource = {
  id: 'deliveries',
  label: 'Deliveries',
  module: 'shopping',
  description: 'Parcels due to arrive, on the day the shipping email gives.',

  async fetch(): Promise<AgendaItem[]> {
    return [];
  },

  async context(ctx: SourceContext): Promise<DayContext[]> {
    const supabase = await (ctx.clients ?? sessionClients).shopping();
    // Context before today is dropped by the merge, so the query starts there
    // rather than at the window's year-old start.
    const today = todayIn(ctx.timezone, ctx.now);
    const from = ctx.from > today ? ctx.from : today;

    const { data, error } = await supabase
      .from('shipments')
      .select(
        'id, status, carrier, expected_on, orders!inner ( id, user_id, deleted_at, external_order_number, merchants ( name ) )',
      )
      .eq('orders.user_id', ctx.userId)
      .is('orders.deleted_at', null)
      .in('status', COMING)
      .gte('expected_on', from)
      .lte('expected_on', ctx.to)
      .order('expected_on', { ascending: true })
      .limit(50);

    if (error) throw new Error(error.message);

    return ((data ?? []) as Row[]).map((row) => {
      const order = one(row.orders);
      const merchant = one(order?.merchants);
      const name = (merchant?.name as string | undefined) ?? null;
      const carrier = (row.carrier as string | null) ?? null;

      return {
        key: `delivery:${row.id as string}`,
        ref: `public.shipments:${row.id as string}`,
        day: row.expected_on as string,
        at: null,
        label: name ? `Parcel from ${name}` : 'A parcel',
        detail:
          [row.status === 'out_for_delivery' ? 'Out for delivery' : null, carrier]
            .filter(Boolean)
            .join(' · ') || null,
        // The order page, which carries the tracking link: the agenda opens
        // its links in the same tab, and a carrier's site is not somewhere to
        // leave the app for without asking.
        link: order ? { href: `/shopping/orders/${order.id as string}`, label: 'Open the order' } : null,
      };
    });
  },
};
