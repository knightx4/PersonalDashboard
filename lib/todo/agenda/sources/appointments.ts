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
 * Appointments booked by email, from todo.appointments (plan #1127).
 *
 * Day context, like an interview: a haircut at three is something the day
 * holds, not something to tick off. The appointments linker
 * (lib/todo/appointments/linker.ts) writes the rows from booking mail, moves
 * one when a change arrives and marks it cancelled when a cancellation does,
 * so this reads only the ones still booked.
 */

type Row = Record<string, unknown>;

export const appointmentsSource: AgendaSource = {
  id: 'appointments',
  label: 'Appointments',
  module: 'todo',
  description: 'Appointments and reservations confirmed by email, at their time.',

  async fetch(): Promise<AgendaItem[]> {
    return [];
  },

  async context(ctx: SourceContext): Promise<DayContext[]> {
    const supabase = await (ctx.clients ?? sessionClients).todo();
    const today = todayIn(ctx.timezone, ctx.now);
    const from = ctx.from > today ? ctx.from : today;

    const { data, error } = await supabase
      .from('appointments')
      .select('id, title, provider, starts_on, starts_at, location')
      .eq('user_id', ctx.userId)
      .eq('status', 'booked')
      .gte('starts_on', from)
      .lte('starts_on', ctx.to)
      .order('starts_on', { ascending: true })
      .order('starts_at', { ascending: true, nullsFirst: true })
      .limit(50);

    if (error) throw new Error(error.message);

    return ((data ?? []) as Row[]).map((row) => {
      const title = row.title as string;
      const provider = (row.provider as string | null) ?? null;
      // "Haircut" with "Fade Room" beside it; a title that already names the
      // provider ("Dinner at Lilia") needs no second mention.
      const withWhom =
        provider && !title.toLowerCase().includes(provider.toLowerCase()) ? provider : null;

      return {
        key: `appointment:${row.id as string}`,
        day: row.starts_on as string,
        at: (row.starts_at as string | null) ?? null,
        label: title,
        detail: [withWhom, (row.location as string | null) ?? null].filter(Boolean).join(' · ') || null,
        link: null,
      };
    });
  },
};
