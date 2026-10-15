import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { loadWaitingOnYou, type WaitingOnYou } from './waiting';

export type { WaitingOnYou };

/**
 * The week, as three questions.
 *
 * Everything else in this workspace is an archive you consult. After six
 * months there were 341 pursuits on the board, 203 of them dead, and exactly
 * one thing on it with a deadline -- an interview, three screens away from
 * where you land. A list sorted by recency cannot answer "what do I have to do
 * today", because the answer is four rows and they are scattered through it.
 *
 * So this asks the three questions directly, and each section is empty when
 * there is nothing to say. An empty page here is the correct answer on a quiet
 * day, and it should not be padded out to look busy.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead an interview is worth surfacing. */
export const INTERVIEW_HORIZON_DAYS = 14;

export interface UpcomingInterview {
  id: string;
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  scheduledAt: string;
  /** False when only the day is settled: the hour is not to be shown. */
  timeKnown: boolean;
  kind: string;
  format: string | null;
  durationMinutes: number | null;
  meetingUrl: string | null;
  location: string | null;
  hasPrep: boolean;
  /** The round it belongs to. Every interview is in one; see interview-groups. */
  groupId: string | null;
  round: { id: string; roundNumber: number | null; label: string | null; notes: string } | null;
}

export interface TodayBoard {
  interviews: UpcomingInterview[];
  waiting: WaitingOnYou[];
  /** True when every section is empty, so the page can say so once. */
  clear: boolean;
}

type RoleJoin = { id: string; title: string; companies: { name: string } };

/**
 * Whether a round has been prepared for.
 *
 * Either note counts. Prep was one column -- the box you type into -- so a
 * round the app had written a full brief for still nudged "no prep notes" on
 * This week, which is the opposite of what the nudge is for: it asks whether
 * anybody has looked at the day, and the generated note is somebody having
 * looked. Presence, not content: the note is stored as sections and a row that
 * has one has been prepared for whatever they say.
 */
export function isPrepped(row: { prep_notes: string | null; prep_note: unknown }): boolean {
  return Boolean(row.prep_notes?.trim()) || row.prep_note != null;
}

export async function loadToday(
  supabase: AppSupabaseClient,
  userId: string,
  opts: { now?: Date } = {},
): Promise<TodayBoard> {
  const now = opts.now ?? new Date();

  const [interviewRows, waiting] = await Promise.all([
    supabase
      .from('interviews')
      .select(
        'id, application_id, round, kind, scheduled_at, time_known, duration_minutes, format, meeting_url, location, prep_notes, prep_note, group_id, interview_groups ( id, round_number, label, notes ), applications!inner ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      // A day's back-reach, because a round known only by its day is stored at
      // that day's midnight: without it, an interview later today drops off
      // This week from the moment the day begins. The rows that reaches back
      // for are filtered on the day being over, just below.
      .gte('scheduled_at', new Date(now.getTime() - DAY_MS).toISOString())
      .lte('scheduled_at', new Date(now.getTime() + INTERVIEW_HORIZON_DAYS * DAY_MS).toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50),

    // Mail that asked you something, less what you have dealt with or put
    // off. A failed read leaves it out rather than taking the page down, as
    // the page always has.
    loadWaitingOnYou(supabase, userId, now).catch((): WaitingOnYou[] => []),
  ]);

  type InterviewRaw = {
    id: string;
    application_id: string;
    kind: string;
    scheduled_at: string;
    time_known: boolean | null;
    duration_minutes: number | null;
    format: string | null;
    meeting_url: string | null;
    location: string | null;
    prep_notes: string | null;
    /** The generated note, whatever its sections are. Only its presence is read here. */
    prep_note: unknown;
    group_id: string | null;
    interview_groups: {
      id: string;
      round_number: number | null;
      label: string | null;
      notes: string | null;
    } | null;
    applications: { roles: RoleJoin };
  };

  const interviews: UpcomingInterview[] = (
    (interviewRows.data ?? []) as unknown as InterviewRaw[]
  )
    // A round with an hour is upcoming until that hour; one known only by its
    // day is upcoming until the day is out.
    .filter((row) => {
      const at = new Date(row.scheduled_at).getTime();
      return (row.time_known === false ? at + DAY_MS : at) >= now.getTime();
    })
    .map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      roleId: row.applications.roles.id,
      companyName: row.applications.roles.companies.name,
      roleTitle: row.applications.roles.title,
      scheduledAt: row.scheduled_at,
      timeKnown: row.time_known ?? true,
      kind: row.kind,
      format: row.format,
      durationMinutes: row.duration_minutes,
      meetingUrl: row.meeting_url,
      location: row.location,
      hasPrep: isPrepped(row),
      groupId: row.group_id,
      round: row.interview_groups
        ? {
            id: row.interview_groups.id,
            roundNumber: row.interview_groups.round_number,
            label: row.interview_groups.label,
            notes: row.interview_groups.notes ?? '',
          }
        : null,
    }));

  return {
    interviews,
    waiting,
    clear: interviews.length === 0 && waiting.length === 0,
  };
}
