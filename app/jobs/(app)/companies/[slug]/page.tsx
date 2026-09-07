import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { CardSection } from '@/components/ui/card';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { formatDate } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { ReminderActions } from '@/app/jobs/(app)/today/reminder-actions';
import { CompanyName } from './company-name';
import { CompanyPanels } from './panels';
import { RolesList } from './roles-list';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { loadTasksFor } from '@/lib/todo/links/load';

export const metadata = { title: 'Company' };

/**
 * The reason companies are a separate entity from roles: this page stays
 * valuable after a specific posting closes. Research, contacts, every role you
 * have pursued here across cycles, and every touch.
 */
export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, name, slug, domains, ats_type, ats_board_token, careers_url, website, linkedin_url, logo_url, industry, stage, headcount_band, hq_location, priority, research, status',
    )
    .eq('user_id', user.id)
    .eq('slug', slug)
    .maybeSingle();

  if (!company) notFound();

  const [{ data: roles }, { data: contacts }, { data: touches }, { data: notes }, { data: profile }] =
    await Promise.all([
      supabase
        .from('roles')
        .select(
          'id, title, location, first_seen_at, posting_status, applications ( id, attempt, status, submitted_at, outcome )',
        )
        .eq('company_id', company.id)
        .order('first_seen_at', { ascending: false }),
      supabase
        .from('contacts')
        .select('id, full_name, title, relationship, status, linkedin_url, email, how_we_connect')
        .eq('company_id', company.id)
        .order('full_name'),
      supabase
        .from('contact_touches')
        .select('id, channel, direction, sent_at, responded_at, message, contacts!inner ( id, full_name, company_id )')
        .eq('user_id', user.id)
        .eq('contacts.company_id', company.id)
        .order('sent_at', { ascending: false })
        .limit(50),
      supabase
        .from('notes')
        .select('id, body, pinned, created_at')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    ]);

  const timezone = (profile?.timezone as string) ?? 'UTC';
  const linkedTasks = await loadTasksFor(user.id, 'company', company.id as string);

  type RoleRow = {
    id: string;
    title: string;
    location: string | null;
    first_seen_at: string;
    posting_status: string;
    applications: Array<{
      id: string;
      attempt: number;
      status: ApplicationStatus;
      submitted_at: string | null;
      outcome: string | null;
    }>;
  };

  const roleRows = (roles ?? []) as unknown as RoleRow[];

  /**
   * The to-dos sitting on this company's roles.
   *
   * A to-do is written on a role page and stored against that pursuit, so the
   * company page -- which is where you go to ask "what is outstanding here" --
   * had no way to see any of them, and said nothing while four were due. It is
   * a read: they stay owned by the role, and adding one is still done there,
   * where the mail to hang it on is.
   */
  const applicationIds = roleRows.flatMap((role) =>
    role.applications.map((application) => application.id),
  );
  const roleByApplication = new Map(
    roleRows.flatMap((role) =>
      role.applications.map((application) => [application.id, role] as const),
    ),
  );

  const { data: reminders } = applicationIds.length
    ? await supabase
        .from('reminders')
        .select('id, body, due_at, application_id')
        .in('application_id', applicationIds)
        .is('completed_at', null)
        .order('due_at', { ascending: true })
    : { data: [] };

  const todos = (reminders ?? []).map((reminder) => ({
    id: reminder.id as string,
    body: reminder.body as string,
    dueAt: reminder.due_at as string,
    role: roleByApplication.get(reminder.application_id as string) ?? null,
  }));

  return (
    <>
      <PageHeader
        leading={
          <CompanyAvatar
            company={{
              name: company.name as string,
              logoUrl: company.logo_url as string | null,
              domains: (company.domains as string[] | null) ?? [],
              website: company.website as string | null,
              careersUrl: company.careers_url as string | null,
            }}
            className="size-11 rounded-xl"
            imageClassName="size-7"
          />
        }
        title={
          <CompanyName companyId={company.id as string} name={company.name as string} />
        }
        description={
          [company.industry, company.hq_location, company.stage]
            .filter(Boolean)
            .join(' · ') || 'No detail recorded yet.'
        }
        actions={
          <div className="flex items-center gap-2 text-ui">
            <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-muted">
              {company.priority as string}
            </span>
            {company.careers_url && (
              <a
                href={company.careers_url as string}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
              >
                Careers
              </a>
            )}
          </div>
        }
      />

      <CardSection title="Roles here, across cycles" className="mb-6">
        <RolesList
          companyId={company.id as string}
          timezone={timezone}
          roles={roleRows.map((role) => ({
            id: role.id,
            title: role.title,
            location: role.location,
            firstSeenAt: role.first_seen_at,
            applications: role.applications.map((application) => ({
              id: application.id,
              attempt: application.attempt,
              status: application.status,
              submittedAt: application.submitted_at,
              outcome: application.outcome,
            })),
          }))}
        />
      </CardSection>

      {todos.length > 0 && (
        <CardSection
          className="mb-6"
          title={
            <>
              To-dos{' '}
              <span className="tabular text-small font-normal text-ink-muted">{todos.length}</span>
            </>
          }
        >
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li key={todo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
                <span className="tabular shrink-0 text-ink-muted">
                  {formatDate(todo.dueAt, timezone)}
                </span>
                <span className="text-ink">{todo.body}</span>
                {/* Which pursuit it belongs to, and the way to it: the to-do is
                    the role's, and everything you would do with it beyond
                    finishing it is done there. */}
                {todo.role && (
                  <Link
                    href={`/jobs/roles/${todo.role.id}`}
                    className="truncate text-small text-ink-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
                  >
                    {todo.role.title}
                  </Link>
                )}
                <ReminderActions id={todo.id} />
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      <div className="mb-6">
        <LinkedTasks
          target="company"
          targetId={company.id as string}
          returnTo={`/jobs/companies/${company.slug as string}`}
          tasks={linkedTasks}
          timezone={timezone}
        />
      </div>

      <CompanyPanels
        companyId={company.id as string}
        research={(company.research as string) ?? ''}
        domains={((company.domains as string[]) ?? []).join(', ')}
        industry={(company.industry as string) ?? ''}
        hqLocation={(company.hq_location as string) ?? ''}
        careersUrl={(company.careers_url as string) ?? ''}
        linkedinUrl={(company.linkedin_url as string) ?? ''}
        website={(company.website as string) ?? ''}
        priority={company.priority as string}
        timezone={timezone}
        contacts={(contacts ?? []).map((contact) => ({
          id: contact.id as string,
          fullName: contact.full_name as string,
          title: (contact.title as string) ?? null,
          relationship: contact.relationship as string,
          status: contact.status as string,
          linkedinUrl: (contact.linkedin_url as string) ?? null,
          email: (contact.email as string) ?? null,
          howWeConnect: (contact.how_we_connect as string) ?? null,
        }))}
        touches={((touches ?? []) as unknown as Array<{
          id: string;
          channel: string;
          direction: string;
          sent_at: string;
          responded_at: string | null;
          message: string | null;
          contacts: { full_name: string };
        }>).map((touch) => ({
          id: touch.id,
          channel: touch.channel,
          direction: touch.direction,
          sentAt: touch.sent_at,
          respondedAt: touch.responded_at,
          message: touch.message,
          contactName: touch.contacts.full_name,
        }))}
        notes={(notes ?? []).map((note) => ({
          id: note.id as string,
          body: note.body as string,
          createdAt: note.created_at as string,
        }))}
      />
    </>
  );
}
