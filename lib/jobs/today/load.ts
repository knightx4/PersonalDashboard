import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { loadPipeline, type PipelineRow } from '@/lib/jobs/applications/load';
import {
  addressOnly,
  composeFollowUp,
  displayName,
  gmailComposeUrl,
} from '@/lib/jobs/followup/compose';
import { DEFAULT_GHOST_THRESHOLD_DAYS, TERMINAL_STATUSES, isTerminal } from '@/lib/jobs/pipeline';

/**
 * The week, as four questions.
 *
 * Everything else in this workspace is an archive you consult. After six
 * months there were 341 pursuits on the board, 203 of them dead, and exactly
 * one thing on it with a deadline -- an interview, three screens away from
 * where you land. A list sorted by recency cannot answer "what do I have to do
 * today", because the answer is four rows and they are scattered through it.
 *
 * So this asks the four questions directly, and each section is empty when
 * there is nothing to say. An empty page here is the correct answer on a quiet
 * day, and it should not be padded out to look busy.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead an interview is worth surfacing. */
export const INTERVIEW_HORIZON_DAYS = 14;

/** How close to being written off a pursuit has to be to be worth a nudge. */
export const GOING_QUIET_WINDOW_DAYS = 7;

/**
 * How far ahead a reminder is worth surfacing.
 *
 * Rule-generated reminders are always due the moment they are raised, so this
 * only matters for a custom to-do with a future date -- without it, one due in
 * three days is invisible on "This week" until the day it is already late.
 */
export const REMINDER_HORIZON_DAYS = 7;

/**
 * How far "Later" pushes a nudge. Long enough that deferring is a decision
 * rather than a way of clearing the screen.
 *
 * Here rather than beside the action that uses it: a `'use server'` module may
 * only export async functions, so a constant shared with the client cannot
 * live there.
 */
export const SNOOZE_DAYS = 7;

export interface UpcomingInterview {
  id: string;
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  scheduledAt: string;
  kind: string;
  format: string | null;
  durationMinutes: number | null;
  meetingUrl: string | null;
  location: string | null;
  hasPrep: boolean;
}

export interface DueReminder {
  id: string;
  kind: string;
  body: string;
  dueAt: string;
  applicationId: string | null;
  roleId: string | null;
  companyName: string | null;
  roleTitle: string | null;
  /** A Gmail compose window with the follow-up already written, when one fits. */
  followUpHref: string | null;
}

export interface WaitingOnYou {
  eventId: string;
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  kind: string;
  summary: string | null;
  occurredAt: string;
}

export interface GoingQuiet {
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  lastActivityAt: string | null;
  daysSinceActivity: number;
  daysUntilGhosted: number;
  followUpHref: string | null;
}

export interface TodayBoard {
  interviews: UpcomingInterview[];
  reminders: DueReminder[];
  waiting: WaitingOnYou[];
  quiet: GoingQuiet[];
  /** True when every section is empty, so the page can say so once. */
  clear: boolean;
}

type RoleJoin = { id: string; title: string; companies: { name: string } };

export async function loadToday(
  supabase: AppSupabaseClient,
  userId: string,
  opts: { now?: Date; ghostThresholdDays?: number; senderName?: string | null } = {},
): Promise<TodayBoard> {
  const now = opts.now ?? new Date();
  const ghostDays = opts.ghostThresholdDays ?? DEFAULT_GHOST_THRESHOLD_DAYS;

  const [interviewRows, reminderRows, eventRows, quietRows] = await Promise.all([
    supabase
      .from('interviews')
      .select(
        'id, application_id, round, kind, scheduled_at, duration_minutes, format, meeting_url, location, prep_notes, applications!inner ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', new Date(now.getTime() + INTERVIEW_HORIZON_DAYS * DAY_MS).toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50),

    supabase
      .from('reminders')
      .select(
        'id, kind, body, due_at, application_id, applications ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .is('completed_at', null)
      .lte('due_at', new Date(now.getTime() + REMINDER_HORIZON_DAYS * DAY_MS).toISOString())
      .order('due_at', { ascending: true })
      .limit(50),

    // Mail that asked you something. `action_required` is set by the extractor
    // when the body contains a request rather than a notification, and it is
    // the only signal here that comes from the words rather than from a clock.
    supabase
      .from('application_events')
      .select(
        'id, application_id, kind, summary, occurred_at, applications!inner ( status, roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .eq('payload->>action_required', 'true')
      .gte('occurred_at', new Date(now.getTime() - 21 * DAY_MS).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(30),

    // Through the pipeline loader rather than a query of its own: "last
    // activity" is derived from the event log, not stored on the application,
    // and a second derivation of it here is how two screens start disagreeing
    // about which pursuits are stale.
    loadPipeline(supabase, userId),
  ]);

  type InterviewRaw = {
    id: string;
    application_id: string;
    kind: string;
    scheduled_at: string;
    duration_minutes: number | null;
    format: string | null;
    meeting_url: string | null;
    location: string | null;
    prep_notes: string | null;
    applications: { roles: RoleJoin };
  };

  const interviews: UpcomingInterview[] = (
    (interviewRows.data ?? []) as unknown as InterviewRaw[]
  ).map((row) => ({
    id: row.id,
    applicationId: row.application_id,
    roleId: row.applications.roles.id,
    companyName: row.applications.roles.companies.name,
    roleTitle: row.applications.roles.title,
    scheduledAt: row.scheduled_at,
    kind: row.kind,
    format: row.format,
    durationMinutes: row.duration_minutes,
    meetingUrl: row.meeting_url,
    location: row.location,
    hasPrep: Boolean(row.prep_notes?.trim()),
  }));

  type ReminderRaw = {
    id: string;
    kind: string;
    body: string;
    due_at: string;
    application_id: string | null;
    applications: { roles: RoleJoin } | null;
  };

  const reminders: DueReminder[] = ((reminderRows.data ?? []) as unknown as ReminderRaw[]).map(
    (row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      dueAt: row.due_at,
      applicationId: row.application_id,
      roleId: row.applications?.roles.id ?? null,
      companyName: row.applications?.roles.companies.name ?? null,
      roleTitle: row.applications?.roles.title ?? null,
      followUpHref: null,
    }),
  );

  type EventRaw = {
    id: string;
    application_id: string;
    kind: string;
    summary: string | null;
    occurred_at: string;
    applications: { status: string; roles: RoleJoin };
  };

  const waiting: WaitingOnYou[] = ((eventRows.data ?? []) as unknown as EventRaw[])
    // A request on a pursuit that has since closed is not waiting on anybody.
    .filter((row) => !TERMINAL_STATUSES.includes(row.applications.status as never))
    .map((row) => ({
      eventId: row.id,
      applicationId: row.application_id,
      roleId: row.applications.roles.id,
      companyName: row.applications.roles.companies.name,
      roleTitle: row.applications.roles.title,
      kind: row.kind,
      summary: row.summary,
      occurredAt: row.occurred_at,
    }));

  const quiet = selectGoingQuiet(quietRows, {
    ghostDays,
    withInterview: new Set(interviews.map((i) => i.applicationId)),
    alreadyNudged: new Set(
      reminders.map((r) => r.applicationId).filter((id): id is string => Boolean(id)),
    ),
  });

  // Who to write to, for everything on the page that could be followed up.
  // One query for all of them rather than one each: this page is opened every
  // morning and a round trip per row would be felt.
  const needsDraft = [
    ...reminders.filter((r) => r.kind === 'follow_up' && r.applicationId),
    ...quiet,
  ];
  const correspondents = await lastCorrespondents(
    supabase,
    userId,
    needsDraft.map((r) => ('applicationId' in r ? r.applicationId : null)),
  );

  const submittedAt = new Map(quietRows.map((row) => [row.applicationId, row.submittedAt]));

  const draftFor = (
    applicationId: string | null,
    companyName: string | null,
    roleTitle: string | null,
  ): string | null => {
    if (!applicationId || !companyName) return null;
    const correspondent = correspondents.get(applicationId);
    const draft = composeFollowUp({
      companyName,
      roleTitle,
      appliedAt: submittedAt.get(applicationId) ?? null,
      recipientName: displayName(correspondent?.fromAddress),
      senderName: opts.senderName ?? null,
      now,
    });
    return gmailComposeUrl({
      emailAddress: correspondent?.inbox ?? null,
      to: addressOnly(correspondent?.fromAddress),
      subject: draft.subject,
      body: draft.body,
    });
  };

  for (const reminder of reminders) {
    reminder.followUpHref =
      reminder.kind === 'follow_up'
        ? draftFor(reminder.applicationId, reminder.companyName, reminder.roleTitle)
        : null;
  }
  for (const row of quiet) {
    row.followUpHref = draftFor(row.applicationId, row.companyName, row.roleTitle);
  }

  return {
    interviews,
    reminders,
    waiting,
    quiet,
    clear:
      interviews.length === 0 &&
      reminders.length === 0 &&
      waiting.length === 0 &&
      quiet.length === 0,
  };
}

/**
 * Which live pursuits are close enough to being written off to say so.
 *
 * Pulled out of the loader because the exclusions are the whole point and they
 * are what a query cannot express: a pursuit with an interview booked is not
 * going quiet however long ago the last email was, and one that already has a
 * nudge in the section above does not need saying twice on the same screen.
 * Saying it twice is not saying it louder -- it is the thing that makes a page
 * like this feel like noise.
 */
export function selectGoingQuiet(
  rows: readonly PipelineRow[],
  opts: {
    ghostDays: number;
    withInterview: ReadonlySet<string>;
    alreadyNudged: ReadonlySet<string>;
  },
): GoingQuiet[] {
  const floor = opts.ghostDays - GOING_QUIET_WINDOW_DAYS;

  return rows
    .filter((row) => !isTerminal(row.status))
    .filter((row) => !opts.withInterview.has(row.applicationId))
    .filter((row) => !opts.alreadyNudged.has(row.applicationId))
    .filter((row) => (row.daysSinceActivity ?? 0) >= floor)
    .map((row) => ({
      applicationId: row.applicationId,
      roleId: row.roleId,
      companyName: row.companyName,
      roleTitle: row.roleTitle,
      lastActivityAt: row.lastActivityAt,
      daysSinceActivity: row.daysSinceActivity ?? 0,
      daysUntilGhosted: Math.max(0, opts.ghostDays - (row.daysSinceActivity ?? 0)),
      // Filled in by loadToday once it knows who to write to; the selection
      // itself is pure and has no database to ask.
      followUpHref: null,
    }))
    .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
}

/**
 * The most recent inbound sender on each pursuit.
 *
 * The address a follow-up should go to is whoever last wrote to you about it,
 * which is often a person even when the first confirmation came from a
 * no-reply. Where it is still a no-reply the draft is written anyway, without
 * a recipient -- an unaddressed draft is a smaller problem than no draft.
 */
async function lastCorrespondents(
  supabase: AppSupabaseClient,
  userId: string,
  applicationIds: readonly (string | null)[],
): Promise<Map<string, { fromAddress: string | null; inbox: string | null }>> {
  const ids = [...new Set(applicationIds.filter((id): id is string => Boolean(id)))];
  const found = new Map<string, { fromAddress: string | null; inbox: string | null }>();
  if (ids.length === 0) return found;

  const { data } = await supabase
    .from('inbox_messages')
    .select('resulting_application_id, from_address, reply_to_address, email_address, received_at')
    .eq('user_id', userId)
    .in('resulting_application_id', ids)
    .order('received_at', { ascending: false });

  for (const row of data ?? []) {
    const id = row.resulting_application_id as string;
    if (found.has(id)) continue;
    found.set(id, {
      // Reply-to first: an ATS sends from a no-reply and points replies at the
      // recruiter, and the recruiter is the one who answers.
      fromAddress: (row.reply_to_address as string) ?? (row.from_address as string) ?? null,
      inbox: (row.email_address as string) ?? null,
    });
  }

  return found;
}
