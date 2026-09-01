import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { StatusPicker } from '@/components/jobs/ui/status-picker';
import { formatDate } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { CompanyPanels } from './panels';

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
      'id, name, slug, domains, ats_type, ats_board_token, careers_url, website, linkedin_url, industry, stage, headcount_band, hq_location, priority, research, status',
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

  return (
    <>
      <PageHeader
        title={company.name as string}
        description={
          [company.industry, company.hq_location, company.stage]
            .filter(Boolean)
            .join(' · ') || 'No detail recorded yet.'
        }
        actions={
          <div className="flex items-center gap-2 text-[13px]">
            <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-muted">
              {company.priority as string}
            </span>
            {company.careers_url && (
              <a
                href={company.careers_url as string}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Careers
              </a>
            )}
          </div>
        }
      />

      <section className="mb-6 rounded-card border border-border bg-surface p-4">
        <h2 className="text-[13px] font-semibold text-ink">Roles here, across cycles</h2>
        {roleRows.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-faint">No roles saved at this company yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {roleRows.map((role) => (
              <li key={role.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link
                  href={`/jobs/roles/${role.id}`}
                  className="flex-1 text-[13px] font-medium text-ink hover:text-brand"
                >
                  {role.title}
                </Link>
                {role.location && (
                  <span className="text-[12px] text-ink-faint">{role.location}</span>
                )}
                {role.applications.map((application) => (
                  <span key={application.id} className="flex items-center gap-1.5">
                    <StatusPicker
                      applicationId={application.id}
                      status={application.status as ApplicationStatus}
                    />
                    <span className="tabular text-[11px] text-ink-faint">
                      {application.attempt > 1 && `#${application.attempt} `}
                      {formatDate(application.submitted_at, timezone)}
                    </span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CompanyPanels
        companyId={company.id as string}
        research={(company.research as string) ?? ''}
        domains={((company.domains as string[]) ?? []).join(', ')}
        industry={(company.industry as string) ?? ''}
        hqLocation={(company.hq_location as string) ?? ''}
        careersUrl={(company.careers_url as string) ?? ''}
        linkedinUrl={(company.linkedin_url as string) ?? ''}
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
