import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultViewHref, savedViewsFor } from '@/lib/saved-views/store';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { SearchField } from '@/components/shell/search-field';
import { SearchEmpty } from '@/components/shell/search-empty';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import { IN_PROCESS_OR_LATER, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { companiesDisplay } from '@/lib/jobs/roles-display';
import {
  groupRows,
  listDisplayMenu,
  NO_GROUP,
  parseListDisplay,
  sortRows,
} from '@/lib/list-display';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';

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
  searchParams: Promise<{
    priority?: string;
    active?: string;
    q?: string;
    sort?: string;
    group?: string;
    hide?: string | string[];
  }>;
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

  const displaySpec = companiesDisplay<(typeof companies)[number]>();
  const display = parseListDisplay(displaySpec, params);
  const savedViews = await savedViewsFor(await createCoreClient(), displaySpec.pathname);
  const openOn = defaultViewHref(savedViews, params);
  if (openOn) redirect(openOn);
  const menu = listDisplayMenu(displaySpec, params, savedViews);
  const sections = groupRows(sortRows(filtered, display), display.groupBy);

  /** A filter link that keeps the arrangement, the same as every other list. */
  const filterHref = (opts: Record<string, string | undefined>) =>
    hrefFor({
      sort: display.sort === displaySpec.defaultSort ? undefined : display.sort,
      group: display.group === NO_GROUP ? undefined : display.group,
      hide: display.hidden.length > 0 ? display.hidden.join(',') : undefined,
      ...opts,
    });

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
            <DisplayMenu menu={menu} />
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
              href={filterHref({ active: params.active, q: params.q })}
              active={!priority}
              count={companies.length}
            />
            {PRIORITIES.map((entry) => (
              <RailItem
                key={entry}
                label={entry}
                href={filterHref({ priority: entry, active: params.active, q: params.q })}
                active={priority === entry}
                count={companies.filter((c) => c.priority === entry).length}
              />
            ))}
          </RailGroup>

          <RailGroup label="Pursuing">
            <RailItem
              label="In process or beyond"
              href={filterHref({
                priority: params.priority,
                active: activeOnly ? undefined : '1',
                q: params.q,
              })}
              active={activeOnly}
              count={companies.filter(isActive).length}
            />
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1">
          {/* Directly above the table it narrows, like every other list in the
              app. It sat in the header row beside Add a role until now. The
              priority and pursuing rails, the sort, the grouping and the
              hidden columns are all on the URL and the field carries them, so
              searching from a narrowed table stays narrowed. */}
          <div className="mb-4">
            <SearchField placeholder="Search company, industry, location or domain" />
          </div>

          {filtered.length === 0 && terms.length > 0 ? (
            <SearchEmpty query={params.q ?? ''} />
          ) : (
            <>
              <div className="space-y-5">
                {sections.map((section) => (
                  <div key={section.key} className="space-y-2">
                    {display.group !== NO_GROUP && (
                      <GroupHeader label={section.label} count={section.count} />
                    )}
                    <Table>
                      <THead>
                        <TR>
                          <TH>Company</TH>
                          {!display.hidden.includes('priority') && <TH>Priority</TH>}
                          {!display.hidden.includes('activity') && <TH>Activity</TH>}
                          {!display.hidden.includes('roles') && <TH num>Roles</TH>}
                          {!display.hidden.includes('domains') && <TH>Domains</TH>}
                        </TR>
                      </THead>
                      <TBody>
                        {section.rows.map((company) => (
                          <TR key={company.id} href={`/jobs/companies/${company.slug}`}>
                            <TD primary>
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
                                  {company.name}
                                  {company.hq_location && (
                                    <span className="ml-1.5 font-normal text-ink-muted">
                                      {company.hq_location}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </TD>
                            {!display.hidden.includes('priority') && (
                              <TD label="Priority" muted>
                                {company.priority}
                              </TD>
                            )}
                            {!display.hidden.includes('activity') && (
                              <TD label="Activity" muted>
                                {company.status.replace(/_/g, ' ')}
                              </TD>
                            )}
                            {!display.hidden.includes('roles') && (
                              <TD label="Roles" num muted>
                                {company.roles.length}
                              </TD>
                            )}
                            {!display.hidden.includes('domains') && (
                              <TD label="Domains" muted>
                                {company.domains.length > 0 ? company.domains.join(', ') : '—'}
                              </TD>
                            )}
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-small text-ink-muted">
                Domains are what let a recruiter&rsquo;s personal work address find its company. Add
                them on the company page when mail is not linking.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
