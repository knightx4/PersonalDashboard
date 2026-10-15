import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { roundsOf } from '@/lib/jobs/interview-groups';
import { DEBRIEF_NUDGE_WINDOW_DAYS } from '@/lib/jobs/pipeline';
import { debriefsDue, type DebriefDue } from './debrief';
import { INTERVIEW_HORIZON_DAYS, isPrepped } from './load';

/**
 * The two nudges Jobs' Today used to draw (plan #1937.14): a round just over
 * with nothing written about it, and a round coming up with no prep. They are
 * rows in the Jobs Inbox while the setting for them is on.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A round in the next fortnight that nobody has prepared for. */
export interface UnpreppedRound {
  /** The round's id, or its one interview's when it stands alone. */
  key: string;
  leadId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  scheduledAt: string;
  timeKnown: boolean;
}

type RoleJoin = { id: string; title: string; companies: { name: string } };

type UpcomingRaw = {
  id: string;
  scheduled_at: string;
  time_known: boolean | null;
  prep_notes: string | null;
  prep_note: unknown;
  group_id: string | null;
  interview_groups: { id: string; label: string | null; notes: string | null } | null;
  applications: { roles: RoleJoin };
};

type PastRaw = Omit<UpcomingRaw, 'prep_notes' | 'prep_note'> & { notes: string | null };

/** Whether the person has asked for the nudges (job_search.profiles.show_nudges). */
export async function nudgesWanted(supabase: AppSupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('show_nudges').eq('id', userId).maybeSingle();
  return data?.show_nudges === true;
}

export async function loadNudges(
  supabase: AppSupabaseClient,
  userId: string,
  now: Date,
): Promise<{ debriefs: DebriefDue[]; unprepped: UnpreppedRound[] }> {
  const [upcomingRows, pastRows] = await Promise.all([
    supabase
      .from('interviews')
      .select(
        'id, scheduled_at, time_known, prep_notes, prep_note, group_id, interview_groups ( id, label, notes ), applications!inner ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      // A day's back-reach: a round known only by its day is stored at that
      // day's midnight and is upcoming until the day is out.
      .gte('scheduled_at', new Date(now.getTime() - DAY_MS).toISOString())
      .lte('scheduled_at', new Date(now.getTime() + INTERVIEW_HORIZON_DAYS * DAY_MS).toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50),
    supabase
      .from('interviews')
      .select(
        'id, scheduled_at, time_known, notes, group_id, interview_groups ( id, label, notes ), applications!inner ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .gte('scheduled_at', new Date(now.getTime() - (DEBRIEF_NUDGE_WINDOW_DAYS + 1) * DAY_MS).toISOString())
      .lte('scheduled_at', now.toISOString())
      .limit(50),
  ]);

  const upcoming = ((upcomingRows.data ?? []) as unknown as UpcomingRaw[])
    .filter((row) => {
      const at = new Date(row.scheduled_at).getTime();
      return (row.time_known === false ? at + DAY_MS : at) >= now.getTime();
    })
    .map((row) => ({
      id: row.id,
      groupId: row.group_id,
      scheduledAt: row.scheduled_at,
      timeKnown: row.time_known !== false,
      prepped: isPrepped(row),
      roleId: row.applications.roles.id,
      companyName: row.applications.roles.companies.name,
      roleTitle: row.applications.roles.title,
    }));
  const groups = ((upcomingRows.data ?? []) as unknown as UpcomingRaw[])
    .map((row) => row.interview_groups)
    .filter((group): group is NonNullable<UpcomingRaw['interview_groups']> => group !== null)
    .map((group) => ({ id: group.id, label: group.label, notes: group.notes ?? '' }));

  // One row a round; a round with notes on any of its conversations has been
  // looked at.
  const unprepped: UnpreppedRound[] = roundsOf(upcoming, groups)
    .filter((round) => !round.interviews.some((interview) => interview.prepped))
    .map(({ group, lead }) => ({
      key: group?.id ?? lead.id,
      leadId: lead.id,
      roleId: lead.roleId,
      companyName: lead.companyName,
      roleTitle: lead.roleTitle,
      scheduledAt: lead.scheduledAt,
      timeKnown: lead.timeKnown,
    }));

  const past = (pastRows.data ?? []) as unknown as PastRaw[];
  const debriefs = debriefsDue(
    past.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduled_at,
      timeKnown: row.time_known !== false,
      groupId: row.group_id,
      notes: row.notes,
      roleId: row.applications.roles.id,
      companyName: row.applications.roles.companies.name,
      roleTitle: row.applications.roles.title,
    })),
    past
      .map((row) => row.interview_groups)
      .filter((group): group is NonNullable<PastRaw['interview_groups']> => group !== null)
      .map((group) => ({ id: group.id, label: group.label, notes: group.notes ?? '' })),
    now,
  );

  return { debriefs, unprepped };
}
