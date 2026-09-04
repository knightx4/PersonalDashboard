import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { cn } from '@/lib/cn';
import { publicEnv } from '@/lib/env';
import { PageHeader } from '@/components/shell/page-header';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { loadTasksFor } from '@/lib/todo/links/load';
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
import { RoleCompany } from './role-company';

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
    { data: interviewGroups },
    { data: messages },
    { data: profile },
    { data: reminders },
    matchCandidates,
    { data: companyContacts },
    { data: bank },
    { data: caseLetter },
    { data: allCompanies },
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
           questions_asked, group_id,
           interview_participants ( role, contacts ( id, full_name, title ) )`,
        )
        .eq('application_id', current.id)
        .order('round', { ascending: true }),
      supabase
        .from('application_answers')
        .select(
          'id, answer, status, word_limit, evidence_item_ids, unsupported_claims, questions!inner ( id, text, kind, canonical_answer, times_seen )',
        )
        .eq('application_id', current.id),
      supabase
        .from('notes')
        .select('id, body, pinned, created_at')
        .eq('role_id', id)
        .order('created_at', { ascending: false }),
      // The occasions several rounds belong to -- a superday and its
      // impression of the day as a whole. Empty for almost every pursuit.
      supabase
        .from('interview_groups')
        .select('id, label, notes')
        .eq('application_id', current.id)
        .order('created_at', { ascending: true }),
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
        .select('id, body, due_at, ingested_message_id')
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
      supabase
        .from('cover_letters')
        .select('body, public_slug, public_expires_at')
        .eq('application_id', current.id)
        .eq('user_id', user.id)
        .maybeSingle(),
      // Every company on file, to move this role to the right one by name.
      supabase.from('companies').select('name').eq('user_id', user.id).order('name'),
    ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';

  /**
   * Loose notes written against a round.
   *
   * A second round trip rather than part of the batch above, because the
   * interview ids it filters on come out of that batch. Skipped entirely when
   * there are no rounds, which is most pursuits.
   */
  const interviewIds = (interviews ?? []).map((interview) => interview.id as string);
  const { data: interviewNotes } = interviewIds.length
    ? await supabase
        .from('notes')
        .select('id, body, created_at, interview_id')
        .in('interview_id', interviewIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  const notesByInterview = new Map<string, Array<{ id: string; body: string; createdAt: string }>>();
  for (const note of (interviewNotes ?? []) as Array<Record<string, unknown>>) {
    const key = note.interview_id as string;
    notesByInterview.set(key, [
      ...(notesByInterview.get(key) ?? []),
      {
        id: note.id as string,
        body: note.body as string,
        createdAt: note.created_at as string,
      },
    ]);
  }

  const linkedTasks = await loadTasksFor(user.id, 'role', role.id as string);
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
            <RoleCompany
              roleId={role.id as string}
              name={company.name}
              slug={company.slug}
              companies={(allCompanies ?? []).map((row) => row.name as string)}
            />
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
                  'tabular rounded-full px-2 py-0.5 text-small',
                  coverage.gaps > 0
                    ? 'bg-caution-tint text-ink'
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
                className="text-ui text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Original posting
              </a>
            )}
          </div>
        }
      />

      {current.needs_review && (
        <p className="mb-4 rounded-lg bg-caution-tint px-3 py-2 text-ui text-ink">
          {current.created_by === 'email_inferred'
            ? 'This was created from a confirmation email nobody logged. Check the role and the date, then clear the flag from the review queue.'
            : 'Flagged for review.'}
        </p>
      )}

      <dl className="mb-6 grid gap-px overflow-hidden rounded-card border border-border bg-border text-ui sm:grid-cols-4">
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

      {/* What has to happen about this role, from the todo module. Here rather
          than inside the panels because it is not one of the tabs: it is the
          thing you write down while reading the page, and a note you have to
          go looking for a tab to write is a note that does not get written. */}
      <div className="mb-6">
        <LinkedTasks
          target="role"
          targetId={role.id as string}
          returnTo={`/jobs/roles/${role.id as string}`}
          tasks={linkedTasks}
          timezone={timezone}
        />
      </div>

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
        caseStatement={(caseLetter?.body as string) ?? ''}
        // A slug with a live expiry is what the read function accepts, so a
        // slug alone is not "shared" and must not read as it.
        caseSlug={
          caseLetter?.public_slug && caseLetter?.public_expires_at
            ? (caseLetter.public_slug as string)
            : null
        }
        caseExpiresAt={(caseLetter?.public_expires_at as string) ?? null}
        appOrigin={publicEnv().NEXT_PUBLIC_APP_URL}
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
          customNotes: notesByInterview.get(interview.id as string) ?? [],
          groupId: (interview.group_id as string | null) ?? null,
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
            // Persisted, so the claims you have to check survive the reload
            // between drafting an answer and submitting it.
            evidenceItemIds: (answer.evidence_item_ids as string[]) ?? [],
            unsupportedClaims: (answer.unsupported_claims as string[]) ?? [],
          };
        })}
        notes={(notes ?? []).map((note) => ({
          id: note.id as string,
          body: note.body as string,
          pinned: note.pinned as boolean,
          createdAt: note.created_at as string,
        }))}
        interviewGroups={(interviewGroups ?? []).map((group) => ({
          id: group.id as string,
          label: (group.label as string | null) ?? null,
          notes: (group.notes as string | null) ?? '',
        }))}
        todos={(reminders ?? []).map((reminder) => {
          // The mail a to-do points at is already loaded for the Linked mail
          // tab, so the subject and the deep link come from there rather than
          // from a second query.
          const messageId = (reminder.ingested_message_id as string) ?? null;
          const linked = messageId
            ? ((messages ?? []).find((message) => message.id === messageId) ?? null)
            : null;
          return {
            id: reminder.id as string,
            body: reminder.body as string,
            dueAt: reminder.due_at as string,
            message: linked
              ? {
                  id: linked.id as string,
                  subject: (linked.subject as string) ?? null,
                  gmailHref: gmailHrefByMessage.get(linked.id as string) ?? null,
                }
              : messageId
                // Linked to mail this pursuit no longer carries. Saying so is
                // better than the link silently not being there.
                ? { id: messageId, subject: null, gmailHref: null }
                : null,
          };
        })}
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
      <dt className="text-micro uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-ink" title={hint}>
        {value}
      </dd>
    </div>
  );
}
