/**
 * The follow-up on each application: the person named, why, the drafted note
 * and, once it went, when it was sent and whether they answered. Read by the
 * role page for one application and by the Follow-ups list for every
 * application about to go in or waiting on a reply (designate.ts writes it).
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/** The stages the Follow-ups list shows: still to apply, and applied with no reply yet. */
export const TO_APPLY_STATUSES = ['lead', 'drafting'] as const satisfies readonly ApplicationStatus[];
export const APPLIED_STATUSES = ['submitted', 'acknowledged'] as const satisfies readonly ApplicationStatus[];

export type FollowUpPerson = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  foundByDash: boolean;
};

export type FollowUpNote = { id: string; channel: string; message: string };
export type FollowUpSend = { id: string; channel: string; sentAt: string; respondedAt: string | null };

export type FollowUp = {
  applicationId: string;
  roleId: string;
  role: string;
  companyId: string;
  company: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  person: FollowUpPerson | null;
  why: string | null;
  triedAt: string | null;
  /** The note waiting to go, when there is one. */
  draft: FollowUpNote | null;
  /** The latest note that went to the person about this application. */
  sent: FollowUpSend | null;
};

type AppRow = {
  id: string;
  status: ApplicationStatus;
  submitted_at: string | null;
  created_at: string;
  follow_up_why: string | null;
  follow_up_tried_at: string | null;
  follow_up_contact_id: string | null;
  roles: { id: string; title: string; company_id: string; companies: { name: string } } | null;
  contacts: {
    id: string;
    full_name: string;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    found_by_dash: boolean;
  } | null;
};

const SELECT = `id, status, submitted_at, created_at, follow_up_why, follow_up_tried_at, follow_up_contact_id,
  roles!inner ( id, title, company_id, companies!inner ( name ) ),
  contacts!applications_follow_up_contact_id_fkey ( id, full_name, title, email, linkedin_url, found_by_dash )`;

/**
 * The follow-ups for the applications named, or, with none named, for every
 * application in TO_APPLY_STATUSES and APPLIED_STATUSES, newest first.
 */
export async function loadFollowUps(
  supabase: AppSupabaseClient,
  userId: string,
  only?: { applicationIds: readonly string[] },
): Promise<FollowUp[]> {
  let query = supabase.from('applications').select(SELECT).eq('user_id', userId);
  query = only
    ? query.in('id', [...only.applicationIds])
    : query.in('status', [...TO_APPLY_STATUSES, ...APPLIED_STATUSES]);
  const { data } = await query.order('created_at', { ascending: false }).limit(only ? only.applicationIds.length : 300);
  const apps = ((data ?? []) as unknown as AppRow[]).filter((row) => row.roles);
  if (apps.length === 0) return [];

  const { data: touchRows } = await supabase
    .from('contact_touches')
    .select('id, application_id, contact_id, channel, message, draft, sent_at, responded_at')
    .eq('user_id', userId)
    .eq('direction', 'outbound')
    .in('application_id', apps.map((app) => app.id))
    .order('sent_at', { ascending: false });
  const touches = (touchRows ?? []) as {
    id: string;
    application_id: string;
    contact_id: string;
    channel: string;
    message: string | null;
    draft: boolean;
    sent_at: string;
    responded_at: string | null;
  }[];

  return apps.map((app) => {
    const mine = touches.filter((t) => t.application_id === app.id && t.contact_id === app.follow_up_contact_id);
    const draft = mine.find((t) => t.draft);
    const sent = mine.find((t) => !t.draft);
    const role = app.roles!;
    return {
      applicationId: app.id,
      roleId: role.id,
      role: role.title,
      companyId: role.company_id,
      company: role.companies.name,
      status: app.status,
      submittedAt: app.submitted_at,
      person: app.contacts
        ? {
            id: app.contacts.id,
            name: app.contacts.full_name,
            title: app.contacts.title,
            email: app.contacts.email,
            linkedinUrl: app.contacts.linkedin_url,
            foundByDash: app.contacts.found_by_dash === true,
          }
        : null,
      why: app.follow_up_why,
      triedAt: app.follow_up_tried_at,
      draft: draft ? { id: draft.id, channel: draft.channel, message: draft.message ?? '' } : null,
      sent: sent ? { id: sent.id, channel: sent.channel, sentAt: sent.sent_at, respondedAt: sent.responded_at } : null,
    };
  });
}
