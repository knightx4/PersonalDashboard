import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { connectedAccountIds, connectedInboxes } from '@/lib/core/inbox/accounts';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { excludableDomains } from '@/lib/jobs/review/exclusions';

/**
 * The review queue.
 *
 * Not optional polish: it is the app's maintenance cost, and how fast a linking
 * decision can be made determines whether the pipeline stays trustworthy. Three
 * kinds of row land here, and each one says what it wants from you:
 *
 *   - a message the linker held, with its top candidates and the match reason
 *   - an application the ingestion inferred, waiting for you to confirm it
 *   - an event that would have moved status backwards, written but not applied
 *
 * Message bodies are never stored, so every row links out to Gmail instead.
 */

export const REVIEW_VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Unlinked mail' },
  { id: 'applications', label: 'Inferred' },
  { id: 'events', label: 'Conflicts' },
] as const;

export type ReviewView = (typeof REVIEW_VIEWS)[number]['id'];

export function parseReviewView(value: string | undefined): ReviewView {
  return REVIEW_VIEWS.some((v) => v.id === value) ? (value as ReviewView) : 'all';
}

export interface ReviewCandidate {
  applicationId: string;
  label: string;
  reason: string;
  confidence: number | null;
}

export interface ReviewMessageRow {
  kind: 'message';
  id: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  classification: string;
  reason: string;
  gmailHref: string | null;
  candidates: ReviewCandidate[];
  sortAt: string;
}

export interface ReviewApplicationRow {
  kind: 'application';
  id: string;
  applicationId: string;
  roleId: string;
  companyName: string;
  /**
   * The employer's own sending domains, so the queue can offer to stop hearing
   * from them. ATS and scheduling domains are filtered out where the exclusion
   * is written -- excluding greenhouse.io would silence every employer at once.
   */
  companyDomains: string[];
  roleTitle: string;
  status: string;
  submittedAt: string | null;
  reason: string;
  sortAt: string;
}

export interface ReviewEventRow {
  kind: 'event';
  id: string;
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  status: string;
  eventKind: string;
  summary: string | null;
  occurredAt: string;
  reason: string;
  sortAt: string;
}

export type ReviewRow = ReviewMessageRow | ReviewApplicationRow | ReviewEventRow;

export type ReviewCounts = {
  all: number;
  messages: number;
  applications: number;
  events: number;
};

/** The badge in the top nav. One cheap count, three cheap counts. */
export async function countReviewItems(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  userId: string,
): Promise<number> {
  const accountIds = await connectedAccountIds(core, userId);

  const [messages, applications, events] = await Promise.all([
    accountIds.length
      ? supabase
          .from('inbox_messages')
          .select('id', { count: 'exact', head: true })
          .in('email_account_id', accountIds)
          .eq('parse_status', 'needs_review')
      : Promise.resolve({ count: 0 }),
    supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('needs_review', true),
    supabase
      .from('application_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('needs_review', true),
  ]);

  return (messages.count ?? 0) + (applications.count ?? 0) + (events.count ?? 0);
}

export async function loadReviewQueue(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  userId: string,
): Promise<{ rows: ReviewRow[]; counts: ReviewCounts }> {
  // The mailbox belongs to core; the verdicts below are this workspace's.
  const accounts = await connectedInboxes(core, userId);
  const accountIds = accounts.map((a) => a.id);
  const inboxByAccount = new Map(accounts.map((a) => [a.id, a.emailAddress]));

  const [messagesResult, applicationsResult, eventsResult] = await Promise.all([
    accountIds.length
      ? supabase
          .from('inbox_messages')
          .select(
            'id, email_account_id, thread_id, provider_message_id, subject, from_address, received_at, classification, error, link_confidence',
          )
          .in('email_account_id', accountIds)
          .eq('parse_status', 'needs_review')
          .order('received_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
    supabase
      .from('applications')
      .select(
        'id, status, submitted_at, created_at, created_by, roles!inner ( id, title, companies!inner ( name, domains ) )',
      )
      .eq('user_id', userId)
      .eq('needs_review', true)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('application_events')
      .select(
        'id, application_id, kind, summary, occurred_at, applications!inner ( status, roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .eq('needs_review', true)
      .order('occurred_at', { ascending: false })
      .limit(200),
  ]);

  const messages: ReviewMessageRow[] = ((messagesResult.data ?? []) as never[]).map(
    (raw: Record<string, unknown>) => ({
      kind: 'message' as const,
      id: raw.id as string,
      subject: (raw.subject as string) ?? null,
      fromAddress: (raw.from_address as string) ?? null,
      receivedAt: (raw.received_at as string) ?? null,
      classification: (raw.classification as string) ?? 'unknown',
      reason:
        (raw.error as string) ?? 'Could not decide which application this belongs to.',
      gmailHref: gmailOpenUrl({
        emailAddress: inboxByAccount.get(raw.email_account_id as string) ?? null,
        threadId: (raw.thread_id as string) ?? null,
        messageId: (raw.provider_message_id as string) ?? null,
      }),
      // Candidates are recomputed live in the page rather than stored, so a
      // message held before an application existed can be linked to it now.
      candidates: [],
      sortAt: (raw.received_at as string) ?? new Date(0).toISOString(),
    }),
  );

  type AppRaw = {
    id: string;
    status: string;
    submitted_at: string | null;
    created_at: string;
    created_by: string;
    roles: { id: string; title: string; companies: { name: string; domains: string[] | null } };
  };

  const applications: ReviewApplicationRow[] = (
    (applicationsResult.data ?? []) as unknown as AppRaw[]
  ).map((raw) => ({
    kind: 'application' as const,
    id: raw.id,
    applicationId: raw.id,
    roleId: raw.roles.id,
    companyName: raw.roles.companies.name,
    companyDomains: excludableDomains(raw.roles.companies.domains),
    roleTitle: raw.roles.title,
    status: raw.status,
    submittedAt: raw.submitted_at,
    reason:
      raw.created_by === 'email_inferred'
        ? 'Created from a confirmation email. Check the role and the date.'
        : 'Flagged for review.',
    sortAt: raw.created_at,
  }));

  type EventRaw = {
    id: string;
    application_id: string;
    kind: string;
    summary: string | null;
    occurred_at: string;
    applications: {
      status: string;
      roles: { id: string; title: string; companies: { name: string } };
    };
  };

  const events: ReviewEventRow[] = ((eventsResult.data ?? []) as unknown as EventRaw[]).map(
    (raw) => ({
      kind: 'event' as const,
      id: raw.id,
      applicationId: raw.application_id,
      roleId: raw.applications.roles.id,
      companyName: raw.applications.roles.companies.name,
      roleTitle: raw.applications.roles.title,
      status: raw.applications.status,
      eventKind: raw.kind,
      summary: raw.summary,
      occurredAt: raw.occurred_at,
      reason:
        'This arrived after the application closed. It was recorded but did not change the status.',
      sortAt: raw.occurred_at,
    }),
  );

  const rows: ReviewRow[] = [...messages, ...applications, ...events].sort((a, b) =>
    b.sortAt.localeCompare(a.sortAt),
  );

  return {
    rows,
    counts: {
      all: rows.length,
      messages: messages.length,
      applications: applications.length,
      events: events.length,
    },
  };
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  application_confirmation: 'Confirmation',
  rejection: 'Rejection',
  recruiter_outreach: 'Recruiter outreach',
  recruiter_reply: 'Recruiter reply',
  interview_invite: 'Interview invite',
  scheduling: 'Scheduling',
  assessment: 'Assessment',
  offer: 'Offer',
  networking: 'Networking',
  job_alert: 'Job alert',
  not_relevant: 'Not relevant',
};

export function classificationLabel(value: string): string {
  return CLASSIFICATION_LABELS[value] ?? value;
}

/** One pursuit as the "some other role" picker needs it: a name and a status. */
export interface SearchableRole {
  applicationId: string;
  companyName: string;
  roleTitle: string;
  status: string;
  everSubmitted: boolean;
}

/**
 * The roles a typed query should offer, best first.
 *
 * The scorer above ranks the three suggestions by how well the *message*
 * matches; this ranks by how well the *typing* does, which is a different
 * question and deliberately dumber. Every whitespace-separated term has to
 * appear somewhere in "company · title", so "canonical eng" narrows the way a
 * person expects it to, and a company name alone lists that company's roles.
 */
export function matchRoles(
  roles: readonly SearchableRole[],
  query: string,
  limit = 8,
): SearchableRole[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return roles.slice(0, limit);

  return roles
    .map((role) => {
      const company = role.companyName.toLowerCase();
      const title = role.roleTitle.toLowerCase();
      const haystack = `${company} ${title}`;
      if (!terms.every((term) => haystack.includes(term))) return null;
      // Where the term landed decides the order: the company you typed the
      // start of, then the title you typed the start of, then anything that
      // merely contains the letters. Otherwise "ubs" buries UBS under
      // "Columbus Health".
      const rank = terms.reduce(
        (total, term) =>
          total + (company.startsWith(term) ? 0 : title.startsWith(term) ? 1 : 2),
        0,
      );
      return { role, rank };
    })
    .filter((entry): entry is { role: SearchableRole; rank: number } => entry !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.role);
}
