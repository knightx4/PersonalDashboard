import 'server-only';

import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { roundDetail, roundLabel, roundsOf } from '@/lib/jobs/interview-groups';
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
 *
 * One line per round, the same rule this week's list uses. What the agenda is
 * for is what else a day can hold, and a superday is one afternoon spoken for
 * however many conversations are inside it.
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
        'id, scheduled_at, kind, duration_minutes, meeting_url, group_id, interview_groups ( id, round_number, label ), applications ( roles ( id, title, companies ( name ) ) )',
      )
      .eq('user_id', ctx.userId)
      .gte('scheduled_at', `${ctx.from}T00:00:00.000Z`)
      .lte('scheduled_at', `${ctx.to}T23:59:59.999Z`)
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (error) throw new Error(error.message);

    const interviews = ((data ?? []) as Row[]).map((row) => {
      const role = one(one(row.applications)?.roles);
      const company = one(role?.companies);
      const scheduledAt = row.scheduled_at as string;
      const group = one(row.interview_groups);

      return {
        id: row.id as string,
        scheduledAt,
        day: dayIn(scheduledAt, ctx.timezone),
        groupId: (row.group_id as string | null) ?? null,
        group: group
          ? {
              id: group.id as string,
              label: (group.label as string | null) ?? null,
              roundNumber: (group.round_number as number | null) ?? null,
              notes: '',
            }
          : null,
        kind: interviewKindLabel(String(row.kind ?? '')),
        durationMinutes: (row.duration_minutes as number | null) ?? null,
        label: [company?.name, role?.title].filter(Boolean).join(' · ') || 'Interview',
        roleId: (role?.id as string | undefined) ?? null,
      };
    });

    // One row per round, not per interview -- and per round *per day*, because
    // a day context belongs to exactly one day and a round that ran over two
    // of them must appear in both. Four conversations on one afternoon are one
    // occasion; printed four times over, as they were, the agenda said the
    // Galaxy superday was four separate things to make room for.
    return byDay(interviews).flatMap((onOneDay) =>
      roundsOf(
        onOneDay,
        onOneDay
          .map((interview) => interview.group)
          .filter((group): group is NonNullable<typeof group> => group !== null),
      ).map(({ group, interviews: inRound, lead }) => ({
        key: group ? `interview-round:${group.id}:${lead.day}` : `interview:${lead.id}`,
        day: lead.day,
        // The round starts when its first conversation does, which is what the
        // rest of the day is read against.
        at: lead.scheduledAt,
        label: lead.label,
        detail: roundDetail(roundLabel(group), lead.kind, inRound.length, lead.durationMinutes),
        link: lead.roleId
          ? {
              href: `/jobs/roles/${lead.roleId}?tab=interviews&interview=${lead.id}`,
              label: 'Prep',
            }
          : null,
      })),
    );
  },
};

/** The interviews split into days, days in the order they were given. */
function byDay<T extends { day: string }>(interviews: readonly T[]): T[][] {
  const days = new Map<string, T[]>();
  for (const interview of interviews) {
    days.set(interview.day, [...(days.get(interview.day) ?? []), interview]);
  }
  return [...days.values()];
}

function dayIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
