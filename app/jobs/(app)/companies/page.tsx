import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { SearchField } from '@/components/jobs/shell/search-field';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import { IN_PROCESS_OR_LATER, type ApplicationStatus } from '@/lib/jobs/pipeline';

export const metadata = { title: 'Companies' };

const PRIORITIES = ['target', 'interested', 'backup', 'passed'] as const;

function hrefFor(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/jobs/companies?${query}` : '/jobs/companies';
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ priority?: string; active?: string; q?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const { data } = await supabase
    .from('companies')
    .select(
      'id, name, slug, priority, status, industry, hq_location, domains, website, careers_url, logo_url, roles ( id, applications ( status ) )',
    )
    .eq('user_id', user.id)
    .order('name');

  const companies = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    slug: string;
    priority: string;
    status: string;
    industry: string | null;
    hq_location: string | null;
    domains: string[];
    website: string | null;
    careers_url: string | null;
    logo_url: string | null;
    roles: Array<{ id: string; applications: Array<{ status: ApplicationStatus }> }>;
  }>;

  // A company is "in process or beyond" the moment any pursuit there has —
  // rejected, withdrawn or otherwise closed roles do not count, and neither
  // does one still stuck at submitted, waiting to hear back at all.
  const isActive = (company: (typeof companies)[number]): boolean =>
    company.roles.some((role) =>
      role.applications.some((application) => IN_PROCESS_OR_LATER.includes(application.status)),
    );

  const priority = PRIORITIES.find((p) => p === params.priority);
  const activeOnly = params.active === '1';
  const terms = searchTerms(params.q);

  let filtered = priority ? companies.filter((c) => c.priority === priority) : companies;
  if (activeOnly) filtered = filtered.filter(isActive);
  if (terms.length) {
    // The domains are in here on purpose: a rejection often arrives from an ATS
    // and the only name you remember is the one in the address.
    filtered = filtered.filter((c) =>
      matchesSearch([c.name, c.industry, c.hq_location, ...c.domains], terms),
    );
  }

  if (companies.length === 0) {
    return (
      <>
        <PageHeader
          title="Companies"
          description="The organisations you are pursuing. Separate from roles, because this page stays useful after a posting closes."
        />
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="A company appears here the moment you add a role at it. You can also add a few up front so inbound mail has something to match against on the first inbox scan."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Companies"
        description={
          terms.length
            ? `${filtered.length} of ${companies.length} match “${params.q}”.`
            : `${companies.length} tracked. Notes and contacts here outlive any single posting.`
        }
        actions={
          <>
            <SearchField placeholder="Search companies" />
            <Link href="/jobs/roles/new" className={buttonVariants({ size: 'sm' })}>
              Add a role
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail>
          <RailGroup label="Priority">
            <RailItem
              label="All"
              href={hrefFor({ active: params.active, q: params.q })}
              active={!priority}
              count={companies.length}
            />
            {PRIORITIES.map((entry) => (
              <RailItem
                key={entry}
                label={entry}
                href={hrefFor({ priority: entry, active: params.active, q: params.q })}
                active={priority === entry}
                count={companies.filter((c) => c.priority === entry).length}
              />
            ))}
          </RailGroup>

          <RailGroup label="Pursuing">
            <RailItem
              label="In process or beyond"
              href={hrefFor({
                priority: params.priority,
                active: activeOnly ? undefined : '1',
                q: params.q,
              })}
              active={activeOnly}
              count={companies.filter(isActive).length}
            />
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-ui">
            <thead>
              <tr className="border-b border-border text-left text-micro uppercase tracking-wider text-ink-muted">
                <th className="px-2 py-2 font-semibold">Company</th>
                <th className="px-2 py-2 font-semibold">Priority</th>
                <th className="px-2 py-2 font-semibold">Activity</th>
                <th className="px-2 py-2 font-semibold">Roles</th>
                <th className="px-2 py-2 font-semibold">Domains</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => (
                <tr key={company.id} className="border-b border-border hover:bg-surface">
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-2">
                      <CompanyAvatar
                        company={{
                          name: company.name,
                          logoUrl: company.logo_url,
                          domains: company.domains,
                          website: company.website,
                          careersUrl: company.careers_url,
                        }}
                        className="size-5 rounded"
                        imageClassName="size-4"
                      />
                      <span className="min-w-0">
                        <Link
                          href={`/jobs/companies/${company.slug}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {company.name}
                        </Link>
                        {company.hq_location && (
                          <span className="ml-1.5 text-ink-muted">{company.hq_location}</span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">{company.priority}</td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    {company.status.replace(/_/g, ' ')}
                  </td>
                  <td className="tabular px-2 py-1.5 text-ink-muted">{company.roles.length}</td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    {company.domains.length > 0 ? company.domains.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-micro text-ink-muted">
            Domains are what let a recruiter&rsquo;s personal work address find its company. Add
            them on the company page when mail is not linking.
          </p>
        </div>
      </div>
    </>
  );
}
