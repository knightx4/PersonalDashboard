import 'server-only';

import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { interviewKindLabel } from '@/lib/jobs/interview-kinds';
import type {
  AgendaItem,
  AgendaSource,
  DayContext,
  SourceContext,
} from '@/lib/todo/agenda/sources';

/**
 * Interviews already in the diary, from job_search.interviews.
 *
 * Day context, never items. An interview is an appointment: you do not tick it
 * off, and putting a checkbox beside one would invite a person to lie to their
 * own list. The reason you want Thursday's interview on a general agenda is
 * that it tells you what else Thursday can hold.
 *
 * A source of its own rather than a side effect of the reminders one, so
 * "show me my interviews" and "show me my job to-dos" are two switches. They
 * are genuinely different questions — someone who keeps their to-dos elsewhere
 * may still want the diary — and one switch could only ever answer both.
 */

type Row = Record<string, unknown>;

/** PostgREST returns an embedded row as an object or a one-element array. */
function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

export const jobInterviewsSource: AgendaSource = {
  id: 'job_interviews',
  label: 'Interviews',
  module: 'jobs',
  description: 'Interviews already scheduled, shown at the top of their day.',

  /** Nothing to do, only something to know. See the note above. */
  async fetch(): Promise<AgendaItem[]> {
    return [];
  },

  async context(ctx: SourceContext): Promise<DayContext[]> {
    const supabase = await createJobsClient();

    const { data, error } = await supabase
      .from('interviews')
      .select(
        'id, scheduled_at, kind, duration_minutes, meeting_url, applications ( roles ( id, title, companies ( name ) ) )',
      )
      .eq('user_id', ctx.userId)
      .gte('scheduled_at', `${ctx.from}T00:00:00.000Z`)
      .lte('scheduled_at', `${ctx.to}T23:59:59.999Z`)
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (error) throw new Error(error.message);

    return ((data ?? []) as Row[]).map((row) => {
      const role = one(one(row.applications)?.roles);
      const company = one(role?.companies);
      const scheduledAt = row.scheduled_at as string;

      return {
        key: `interview:${row.id as string}`,
        day: dayIn(scheduledAt, ctx.timezone),
        at: scheduledAt,
        label: [company?.name, role?.title].filter(Boolean).join(' · ') || 'Interview',
        detail: [
          interviewKindLabel(String(row.kind ?? '')),
          row.duration_minutes ? `${row.duration_minutes as number} min` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        link: role
          ? {
              href: `/jobs/roles/${role.id as string}?tab=interviews&interview=${row.id as string}`,
              label: 'Prep',
            }
          : null,
      };
    });
  },
};

function dayIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
