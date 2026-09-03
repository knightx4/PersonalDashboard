import 'server-only';

import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import {
  addressOnly,
  composeFollowUp,
  displayName,
  gmailComposeUrl,
} from '@/lib/jobs/followup/compose';
import { lastCorrespondents } from '@/lib/jobs/followup/recipients';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type {
  AgendaItem,
  AgendaSource,
  DayContext,
  SourceContext,
} from '@/lib/todo/agenda/sources';

/**
 * Follow-ups, prep, thank-yous and deadlines, from job_search.reminders.
 *
 * Nothing is copied. The rows are read where they live and written back where
 * they live: **finishing one sets `completed_at` on the job row and deferring
 * one moves its `due_at`.** One record, two views -- /jobs/today and /todo show
 * the same reminder and cannot disagree about it.
 *
 * The alternative was a todo-side dismissal row for a deferred reminder, and it
 * was wrong in a way worth remembering: finishing would have agreed across both
 * pages, because that is one record, while deferring would have agreed on only
 * one, because that would have been two. Hiding something in one place and
 * still seeing it in the other is how a person learns to distrust both pages.
 *
 * The follow-up composer comes across intact. Commit fd33268 -- *write the
 * follow-up, not just the reminder to send one* -- is the reason this source is
 * eighty lines rather than twenty: knowing a pursuit has gone quiet is the easy
 * half, and the blank compose window is the half that decides whether anything
 * happens.
 */

type Row = Record<string, unknown>;

/** PostgREST returns an embedded row as an object or a one-element array. */
function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

const KIND_LABELS: Record<string, string> = {
  follow_up: 'follow up',
  prep: 'prep',
  thank_you: 'thank you',
  deadline: 'deadline',
  custom: 'reminder',
};

export const jobRemindersSource: AgendaSource = {
  id: 'job_reminders',
  label: 'Job search reminders',
  module: 'jobs',
  description:
    'Follow-ups, prep and thank-yous the job search is holding, with the follow-up already written.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await createJobsClient();

    const { data, error } = await supabase
      .from('reminders')
      .select(
        'id, kind, body, due_at, application_id, applications ( id, submitted_at, roles ( id, title, companies ( name ) ) )',
      )
      .eq('user_id', ctx.userId)
      .is('completed_at', null)
      .lte('due_at', `${ctx.to}T23:59:59.999Z`)
      .order('due_at', { ascending: true })
      .limit(100);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Row[];

    // One query for every draft on the page rather than one each. This page is
    // opened every morning; a round trip per row would be felt.
    const correspondents = await lastCorrespondents(
      supabase,
      ctx.userId,
      rows.map((row) => (row.application_id as string | null) ?? null),
    );

    return rows.map((row) => {
      const application = one(row.applications);
      const role = one(application?.roles);
      const company = one(role?.companies);

      const companyName = (company?.name as string) ?? null;
      const roleTitle = (role?.title as string) ?? null;
      const kind = (row.kind as string) ?? 'custom';
      const dueAt = row.due_at as string;

      return {
        key: reminderKey(row.id as string),
        source: 'job_reminders',
        title: (row.body as string) ?? KIND_LABELS[kind] ?? 'Reminder',
        // The day in the reader's zone, not the UTC slice: a reminder due at
        // 23:30 UTC is tomorrow's problem in Tokyo and today's in London.
        day: dayIn(dueAt, ctx.timezone),
        at: dueAt,
        link: role
          ? { href: `/jobs/roles/${role.id as string}`, label: 'Open the role' }
          : { href: '/jobs/today', label: 'This week' },
        action: followUpFor({
          kind,
          applicationId: (row.application_id as string) ?? null,
          companyName,
          roleTitle,
          appliedAt: (application?.submitted_at as string) ?? null,
          correspondents,
          now: ctx.now,
        }),
        detail: companyName ? `${companyName}${roleTitle ? ` · ${roleTitle}` : ''}` : null,
        completable: true,
      };
    });
  },

  /**
   * Interviews, as context rather than as items.
   *
   * /jobs/today shows these as a section of its own, which is right there --
   * that page is about the job search. Here they are a line at the top of the
   * day, because the reason you want to know about Thursday's interview while
   * reading a general agenda is that it tells you what else Thursday can hold.
   */
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
          String(row.kind ?? '').replace(/_/g, ' '),
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

  async complete(ctx, key) {
    const supabase = await createJobsClient();
    await supabase
      .from('reminders')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', idOf(key))
      .eq('user_id', ctx.userId);
  },

  /**
   * "Later" moves the reminder's own due date.
   *
   * Deliberately not a todo-side dismissal: a reminder's due date is what "not
   * yet" has always meant on the job side, so pushing it is the one write both
   * pages read.
   */
  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);

    const supabase = await createJobsClient();
    await supabase
      .from('reminders')
      .update({ due_at: until.toISOString() })
      .eq('id', idOf(key))
      .eq('user_id', ctx.userId);
  },

  /**
   * "Not this one" completes it.
   *
   * A reminder you have decided not to act on is a reminder that is finished
   * with, and the job side has exactly one way to say that. Inventing a second
   * kind of "gone" -- a dismissal row here that /jobs/today cannot see -- is
   * the split this source exists to avoid.
   */
  async dismiss(ctx, key) {
    await jobRemindersSource.complete?.(ctx, key);
  },
};

function reminderKey(id: string): string {
  return `job_reminders:${id}`;
}

function idOf(key: string): string {
  return key.slice('job_reminders:'.length);
}

function dayIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** The Gmail compose window, already written, for a follow-up reminder. */
function followUpFor(input: {
  kind: string;
  applicationId: string | null;
  companyName: string | null;
  roleTitle: string | null;
  appliedAt: string | null;
  correspondents: Awaited<ReturnType<typeof lastCorrespondents>>;
  now: Date;
}): { href: string; label: string } | null {
  if (input.kind !== 'follow_up') return null;
  if (!input.applicationId || !input.companyName) return null;

  const correspondent = input.correspondents.get(input.applicationId);
  const draft = composeFollowUp({
    companyName: input.companyName,
    roleTitle: input.roleTitle,
    appliedAt: input.appliedAt,
    recipientName: displayName(correspondent?.fromAddress),
    senderName: null,
    now: input.now,
  });

  const href = gmailComposeUrl({
    emailAddress: correspondent?.inbox ?? null,
    to: addressOnly(correspondent?.fromAddress),
    subject: draft.subject,
    body: draft.body,
  });

  return href ? { href, label: 'Write it' } : null;
}
