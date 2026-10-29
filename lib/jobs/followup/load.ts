/**
 * The follow-up on each application: the people named to reach out to about
 * it, why each, the note drafted to each and, once one went, when it was
 * sent and whether they answered. Read by the role page's Outreach tab for
 * one application and by the Follow-ups list for every application about to
 * go in or waiting on a reply (designate.ts and choose.ts write it).
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/** The stages the Follow-ups list shows: still to apply, and applied with no reply yet. */
export const TO_APPLY_STATUSES = ['lead', 'drafting'] as const satisfies readonly ApplicationStatus[];
export const APPLIED_STATUSES = ['submitted', 'acknowledged'] as const satisfies readonly ApplicationStatus[];

export type FollowUpNote = { id: string; channel: string; message: string };
export type FollowUpSend = { id: string; channel: string; sentAt: string; respondedAt: string | null };

/** One person to reach out to about the application, and the note to them. */
export type OutreachPerson = {
  contactId: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  foundByDash: boolean;
  why: string | null;
  chosenBy: 'dash' | 'person';
  /** The note waiting to go, when there is one. */
  draft: FollowUpNote | null;
  /** The latest note that went to them about this application. */
  sent: FollowUpSend | null;
};

export type FollowUp = {
  applicationId: string;
  roleId: string;
  role: string;
  companyId: string;
  company: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  /** When Dash last looked for someone, found or not. */
  triedAt: string | null;
  /** In the order they were named. */
  people: OutreachPerson[];
};

type AppRow = {
  id: string;
  status: ApplicationStatus;
  submitted_at: string | null;
  follow_up_tried_at: string | null;
  roles: { id: string; title: string; company_id: string; companies: { name: string } } | null;
  application_outreach: {
    why: string | null;
    chosen_by: string;
    created_at: string;
    contacts: {
      id: string;
      full_name: string;
      title: string | null;
      email: string | null;
      linkedin_url: string | null;
      found_by_dash: boolean;
    } | null;
  }[];
};

const SELECT = `id, status, submitted_at, created_at, follow_up_tried_at,
  roles!inner ( id, title, company_id, companies!inner ( name ) ),
  application_outreach ( why, chosen_by, created_at, contacts ( id, full_name, title, email, linkedin_url, found_by_dash ) )`;

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
    const role = app.roles!;
    const people = [...(app.application_outreach ?? [])]
      .filter((row) => row.contacts)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((row): OutreachPerson => {
        const contact = row.contacts!;
        const mine = touches.filter((t) => t.application_id === app.id && t.contact_id === contact.id);
        const draft = mine.find((t) => t.draft);
        const sent = mine.find((t) => !t.draft);
        return {
          contactId: contact.id,
          name: contact.full_name,
          title: contact.title,
          email: contact.email,
          linkedinUrl: contact.linkedin_url,
          foundByDash: contact.found_by_dash === true,
          why: row.why,
          chosenBy: row.chosen_by === 'person' ? 'person' : 'dash',
          draft: draft ? { id: draft.id, channel: draft.channel, message: draft.message ?? '' } : null,
          sent: sent ? { id: sent.id, channel: sent.channel, sentAt: sent.sent_at, respondedAt: sent.responded_at } : null,
        };
      });
    return {
      applicationId: app.id,
      roleId: role.id,
      role: role.title,
      companyId: role.company_id,
      company: role.companies.name,
      status: app.status,
      submittedAt: app.submitted_at,
      triedAt: app.follow_up_tried_at,
      people,
    };
  });
}

/** The sends about one application, to anyone, newest first, for the Outreach tab's log. */
export type OutreachSend = {
  id: string;
  contactId: string;
  contactName: string;
  channel: string;
  sentAt: string;
  respondedAt: string | null;
  message: string | null;
};

export async function loadApplicationSends(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<OutreachSend[]> {
  const { data } = await supabase
    .from('contact_touches')
    .select('id, contact_id, channel, sent_at, responded_at, message, contacts ( full_name )')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .eq('direction', 'outbound')
    .eq('draft', false)
    .order('sent_at', { ascending: false });
  return ((data ?? []) as unknown as {
    id: string;
    contact_id: string;
    channel: string;
    sent_at: string;
    responded_at: string | null;
    message: string | null;
    contacts: { full_name: string } | null;
  }[]).map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contacts?.full_name ?? 'Someone',
    channel: row.channel,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
    message: row.message,
  }));
}
