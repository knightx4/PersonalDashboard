import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { StatusPicker } from '@/components/jobs/ui/status-picker';
import { formatCompBand, formatDate } from '@/lib/jobs/applications/load';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { findUnlinkedMessages } from '@/lib/jobs/inbox/link-candidates';
import {
  DEBRIEF_NUDGE_WINDOW_DAYS,
  SOURCE_LABELS,
  formatCoverage,
  requirementCoverage,
  type ApplicationSource,
  type ApplicationStatus,
} from '@/lib/jobs/pipeline';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import { matchKey, type RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import { RoleDetailPanels } from './panels';
import { RoleTitle } from './role-title';

export const metadata = { title: 'Role' };

/**
 * The page you actually live in: the posting, the requirement map, the
 * timeline, the answers, the interviews, the notes, and every email that has
 * been linked to this pursuit.
 */
export default async function RoleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; interview?: string }>;
}) {
  const { id } = await params;
  const { tab, interview: focusInterviewId } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: role } = await supabase
    .from('roles')
    .select(
      `id, title, jd_url, jd_text, jd_hash, jd_lookup_note, ats_job_id, seniority, location, work_mode,
       comp_min_cents, comp_max_cents, comp_source, posting_status, source, first_seen_at,
       requirements, requirement_matches, requirement_matches_at, requirement_matches_key,
       companies!inner ( id, name, slug, ats_type, priority )`,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!role) notFound();

  const company = role.companies as unknown as {
    id: string;
    name: string;
    slug: string;
    ats_type: string;
    priority: string;
  };

  const { data: applications } = await supabase
    .from('applications')
    .select(
      `id, attempt, status, source, submitted_at, confirmation_received_at,
       first_human_response_at, closed_at, outcome, rejection_stage, rejection_stage_override,
       excitement, next_action, next_action_due, needs_review, created_by`,
    )
    .eq('role_id', id)
    .eq('user_id', user.id)
    .order('attempt', { ascending: false });

  const current = (applications ?? [])[0];
  if (!current) notFound();

  const [
    { data: events },
    { data: interviews },
    { data: answers },
    { data: notes },
    { data: messages },
    { data: profile },
    { data: reminders },
    matchCandidates,
    { data: companyContacts },
    { data: bank },
  ] = await Promise.all([
      supabase
        .from('application_events')
        .select(
          'id, kind, occurred_at, source, summary, payload, needs_review, ingested_message_id',
        )
        .eq('application_id', current.id)
        .order('occurred_at', { ascending: false }),
      supabase
        .from('interviews')
        // Participants come back embedded: who is in the room is part of
        // reading a round, and the contact carries the LinkedIn and the title
        // that make the name worth clicking.
        .select(
          `id, round, kind, scheduled_at, duration_minutes, format, status, prep_notes, notes,
           questions_asked,
           interview_participants ( role, contacts ( id, full_name, title ) )`,
        )
        .eq('application_id', current.id)
        .order('round', { ascending: true }),
      supabase
        .from('application_answers')
        .select('id, answer, status, word_limit, questions!inner ( id, text, kind, canonical_answer, times_seen )')
        .eq('application_id', current.id),
      supabase
        .from('notes')
        .select('id, body, pinned, created_at')
        .eq('role_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('inbox_messages')
        // provider_message_id, thread_id and email_address are what the Gmail
        // deep link is built from. The view carries the address so this does
        // not need a second query for the mailbox.
        .select(
          'id, subject, from_address, received_at, classification, link_method, link_confidence, provider_message_id, thread_id, email_address',
        )
        .eq('resulting_application_id', current.id)
        .order('received_at', { ascending: false }),
      supabase.from('profiles').select('timezone').eq('id', user.id).single(),
      supabase
        .from('reminders')
        .select('id, body, due_at')
        .eq('application_id', current.id)
        .is('completed_at', null)
        .order('due_at', { ascending: true }),
      findUnlinkedMessages(supabase, user.id, {
        applicationId: current.id as string,
        term: company.name,
      }),
      // Everyone already known at this company, so naming an interviewer is a
      // pick rather than a retype -- and so the name on the round is the same
      // record as the one on the contacts page.
      supabase
        .from('contacts')
        .select('id, full_name, title')
        .eq('user_id', user.id)
        .eq('company_id', company.id)
        .order('full_name'),
      // Only what the staleness key is computed from. A stored match stays put
      // until the description or the bank changes; without this the page
      // cannot tell a current map from one computed before you added the item
      // that answers its biggest gap.
      supabase.from('evidence_items').select('id, strength, skills').eq('user_id', user.id),
    ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';
  const requirements = (role.requirements as Requirement[] | null) ?? [];

  const evidence = (bank ?? []).map((item) => ({
    id: item.id as string,
    strength: item.strength as number,
    skills: (item.skills as string[]) ?? [],
  }));
  const requirementMatches = (role.requirement_matches as RequirementMatch[] | null) ?? null;
  const coverage = requirementCoverage(requirementMatches);
  const coverageLabel = formatCoverage(coverage);
  const currentMatchKey = matchKey(role.jd_hash as string | null, evidence);

  // Timeline events name the message they came from, and the linked mail is
  // already loaded, so the same deep link can hang off both without a second
  // query. An event with no message (a status you set by hand) has no link.
  const gmailHrefByMessage = new Map<string, string | null>(
    (messages ?? []).map((message) => [
      message.id as string,
      gmailOpenUrl({
        emailAddress: (message.email_address as string) ?? null,
        threadId: (message.thread_id as string) ?? null,
        messageId: (message.provider_message_id as string) ?? null,
      }),
    ]),
  );

  return (
    <>
      <PageHeader
        title={<RoleTitle roleId={role.id as string} title={role.title as string} />}
        description={
          <>
            <Link href={`/jobs/companies/${company.slug}`} className="hover:text-brand">
              {company.name}
            </Link>
            {role.location ? ` · ${role.location}` : ''}
            {role.work_mode ? ` · ${role.work_mode}` : ''}
            {role.seniority ? ` · ${role.seniority}` : ''}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            {coverageLabel && (
              <Link
                href={`/jobs/roles/${role.id}?tab=posting`}
                className={cn(
                  'tabular rounded-full px-2 py-0.5 text-[12px]',
                  coverage.gaps > 0
                    ? 'bg-accent-orange-tint text-ink'
                    : 'bg-status-offer-tint text-status-offer',
                )}
                title={
                  coverage.gaps > 0
                    ? `${coverage.gaps} must-have${coverage.gaps === 1 ? '' : 's'} your bank does not cover`
                    : 'Every must-have covered by your evidence'
                }
              >
                {coverageLabel}
              </Link>
            )}
            <StatusPicker
              applicationId={current.id as string}
              status={current.status as ApplicationStatus}
              submittedAt={current.submitted_at as string | null}
            />
            {role.jd_url && (
              <a
                href={role.jd_url as string}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Original posting
              </a>
            )}
          </div>
        }
      />

      {current.needs_review && (
        <p className="mb-4 rounded-lg bg-accent-orange-tint px-3 py-2 text-[13px] text-ink">
          {current.created_by === 'email_inferred'
            ? 'This was created from a confirmation email nobody logged. Check the role and the date, then clear the flag from the review queue.'
            : 'Flagged for review.'}
        </p>
      )}

      <dl className="mb-6 grid gap-px overflow-hidden rounded-card border border-border bg-border text-[13px] sm:grid-cols-4">
        <Fact label="Applied" value={formatDate(current.submitted_at as string | null, timezone)} />
        <Fact
          label="Confirmed"
          value={formatDate(current.confirmation_received_at as string | null, timezone)}
        />
        <Fact
          label="First human reply"
          value={formatDate(current.first_human_response_at as string | null, timezone)}
          hint="Automated confirmations never set this."
        />
        <Fact
          label="Source"
          value={SOURCE_LABELS[current.source as ApplicationSource] ?? (current.source as string)}
        />
        <Fact
          label="Comp band"
          value={formatCompBand(role.comp_min_cents as number | null, role.comp_max_cents as number | null) ?? '—'}
          hint={role.comp_source ? `From the ${role.comp_source}` : undefined}
        />
        <Fact label="Posting" value={(role.posting_status as string) ?? 'unknown'} />
        <Fact label="ATS" value={company.ats_type === 'unknown' ? '—' : company.ats_type} />
        <Fact
          label="Outcome"
          value={
            current.outcome
              ? `${current.outcome}${
                  current.rejection_stage_override || current.rejection_stage
                    ? ` at ${(current.rejection_stage_override ?? current.rejection_stage) as string}`
                    : ''
                }`
              : '—'
          }
        />
      </dl>

      <RoleDetailPanels
        roleId={role.id as string}
        applicationId={current.id as string}
        jdText={(role.jd_text as string) ?? ''}
        jdLookupNote={(role.jd_lookup_note as string) ?? null}
        jdUrl={(role.jd_url as string) ?? null}
        atsJobId={(role.ats_job_id as string) ?? null}
        compMinCents={(role.comp_min_cents as number) ?? null}
        compMaxCents={(role.comp_max_cents as number) ?? null}
        compSource={(role.comp_source as string) ?? null}
        requirements={requirements}
        requirementMatches={requirementMatches}
        requirementMatchesAt={(role.requirement_matches_at as string) ?? null}
        // Stale rather than absent: the map still reads, it is just no longer
        // the map for this description and this bank.
        requirementMatchesStale={
          requirementMatches !== null &&
          (role.requirement_matches_key as string | null) !== currentMatchKey
        }
        bankSize={evidence.length}
        timezone={timezone}
        initialTab={tab === 'interviews' ? 'interviews' : undefined}
        focusInterviewId={focusInterviewId ?? null}
        events={(events ?? []).map((event) => ({
          id: event.id as string,
          kind: event.kind as string,
          occurredAt: event.occurred_at as string,
          source: event.source as string,
          summary: (event.summary as string) ?? null,
          needsReview: event.needs_review as boolean,
          gmailHref:
            gmailHrefByMessage.get(event.ingested_message_id as string) ?? null,
        }))}
        interviews={(interviews ?? []).map((interview) => ({
          id: interview.id as string,
          round: interview.round as number,
          kind: interview.kind as string,
          scheduledAt: interview.scheduled_at as string | null,
          debriefDue: debriefDue(interview.scheduled_at as string | null),
          format: interview.format as string | null,
          status: interview.status as string,
          prepNotes: (interview.prep_notes as string) ?? '',
          notes: (interview.notes as string) ?? '',
          questionsAsked: (interview.questions_asked as string[]) ?? [],
          participants: (
            (interview.interview_participants ?? []) as unknown as Array<{
              role: string;
              contacts: { id: string; full_name: string; title: string | null } | null;
            }>
          )
            .filter((participant) => participant.contacts !== null)
            .map((participant) => ({
              contactId: participant.contacts!.id,
              name: participant.contacts!.full_name,
              title: participant.contacts!.title,
              role: participant.role,
            })),
        }))}
        companyContacts={((companyContacts ?? []) as unknown as Array<{
          id: string;
          full_name: string;
          title: string | null;
        }>).map((contact) => ({
          id: contact.id,
          name: contact.full_name,
          title: contact.title,
        }))}
        answers={(answers ?? []).map((answer) => {
          const question = answer.questions as unknown as {
            id: string;
            text: string;
            kind: string;
            canonical_answer: string | null;
            times_seen: number;
          };
          return {
            id: answer.id as string,
            answer: (answer.answer as string) ?? '',
            status: answer.status as string,
            questionId: question.id,
            questionText: question.text,
            questionKind: question.kind,
            canonicalAnswer: question.canonical_answer,
            timesSeen: question.times_seen,
          };
        })}
        notes={(notes ?? []).map((note) => ({
          id: note.id as string,
          body: note.body as string,
          pinned: note.pinned as boolean,
          createdAt: note.created_at as string,
        }))}
        todos={(reminders ?? []).map((reminder) => ({
          id: reminder.id as string,
          body: reminder.body as string,
          dueAt: reminder.due_at as string,
        }))}
        messages={(messages ?? []).map((message) => ({
          id: message.id as string,
          subject: (message.subject as string) ?? null,
          fromAddress: (message.from_address as string) ?? null,
          receivedAt: (message.received_at as string) ?? null,
          classification: message.classification as string,
          linkMethod: (message.link_method as string) ?? null,
          linkConfidence: (message.link_confidence as number) ?? null,
          gmailHref: gmailOpenUrl({
            emailAddress: (message.email_address as string) ?? null,
            threadId: (message.thread_id as string) ?? null,
            messageId: (message.provider_message_id as string) ?? null,
          }),
        }))}
        companyName={company.name}
        matchCandidates={matchCandidates}
        otherAttempts={(applications ?? []).slice(1).map((attempt) => ({
          id: attempt.id as string,
          attempt: attempt.attempt as number,
          status: attempt.status as ApplicationStatus,
          submittedAt: attempt.submitted_at as string | null,
          outcome: (attempt.outcome as string) ?? null,
          rejectionStage:
            ((attempt.rejection_stage_override ?? attempt.rejection_stage) as string) ?? null,
        }))}
      />
    </>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Past, and recent enough that "write it up tonight" is still true. Outside
 * the component: reading the clock during render is unstable.
 */
function debriefDue(iso: string | null): boolean {
  if (iso === null) return false;
  const scheduledAt = new Date(iso).getTime();
  const now = Date.now();
  return scheduledAt < now && scheduledAt >= now - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-ink" title={hint}>
        {value}
      </dd>
    </div>
  );
}
