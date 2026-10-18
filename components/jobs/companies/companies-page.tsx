import { Building2 } from 'lucide-react';
import { AddCompany } from '@/app/jobs/(app)/companies/add-company';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { SearchField } from '@/components/shell/search-field';
import { SearchEmpty } from '@/components/shell/search-empty';
import { ColumnHeading } from '@/components/shell/column-heading';
import { RowLink } from '@/components/shell/back-link';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';
import { PageWide } from '@/components/shell/page-width';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import Link from '@/components/ui/link';
import { SectionHeading } from '@/components/ui/section-heading';
import { sectionSubject } from '@/lib/core/section-path';
import { cn } from '@/lib/cn';
import { companiesDisplay } from '@/lib/jobs/roles-display';
import {
  groupRows,
  listDisplayMenu,
  NO_GROUP,
  parseListDisplay,
  sortRows,
  type DisplayChoice,
} from '@/lib/list-display';
import type { SavedView } from '@/lib/saved-views/store';
import { duplicatePairs } from '@/lib/jobs/companies/same-company';
import { formatDate } from '@/lib/jobs/applications/load';
import {
  answeredCount,
  PERSPECTIVE_QUESTIONS,
  perspectiveOf,
} from '@/lib/jobs/companies/perspective';
import { pageOf, withoutPage, type ColumnFilter } from '@/lib/table-view';
import {
  clearFiltersHref,
  companiesCount,
  companiesHref,
  companyColumnFilters,
  COMPANY_PRIORITIES,
  filterCompanies,
  filterNames,
  hasColumnFilters,
  isActiveCompany,
  parseCompanies,
  type CompaniesParams,
  type CompanyRow,
} from '@/lib/jobs/companies-view';

/**
 * The Companies page (plan #2341.3), apart from its loading so the gallery
 * can draw it with fixtures. The table is filtered from its column headers,
 * paged at 50 and kept in the address (lib/jobs/companies-view.ts).
 */
export function CompaniesPage({
  companies,
  params,
  savedViews = [],
  timezone = 'UTC',
  openColumn,
}: {
  companies: readonly CompanyRow[];
  params: CompaniesParams;
  savedViews?: readonly SavedView[];
  timezone?: string;
  /** For the gallery: the column whose menu is drawn open. */
  openColumn?: string;
}) {
  if (companies.length === 0) {
    return (
      <PageWide>
        <PageHeader
          subject={sectionSubject('/jobs/companies', 'Companies')}
          title="Companies"
          description="The organisations you are pursuing. Separate from roles, because this page stays useful after a posting closes."
        />
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="A company appears here the moment you add a role at it. You can also add a few up front so inbound mail has something to match against on the first inbox scan."
        >
          <AddCompany variant="secondary" />
        </EmptyState>
      </PageWide>
    );
  }

  const state = parseCompanies(params);
  const filtered = filterCompanies(companies, state);
  const href = (changes: Partial<Record<keyof CompaniesParams, string | undefined>>) =>
    companiesHref(params, changes);

  // Two rows for one employer split its roles and mail between them, so the
  // pairs are named here with the merge one click away on either page.
  const duplicates = duplicatePairs(companies);

  // The companies marked Target, with how far the view of each has got, led
  // with the ones whose view has not moved for longest. Shown above the table
  // whenever the list is not narrowed to something else.
  const targets = companies
    .filter((company) => company.priority === 'target')
    .map((company) => {
      const perspective = perspectiveOf(company as unknown as Record<string, unknown>);
      return { company, answered: answeredCount(perspective), nextMove: perspective.nextMove };
    })
    .sort(
      (a, b) =>
        (a.company.perspective_updated_at ?? '').localeCompare(
          b.company.perspective_updated_at ?? '',
        ) || a.company.name.localeCompare(b.company.name),
    );
  const narrowed = hasColumnFilters(state);
  const showTargets =
    state.terms.length === 0 &&
    (!narrowed || (state.priority === 'target' && hasOnlyPriority(params)));

  const displaySpec = companiesDisplay<CompanyRow>();
  // The sort, grouping and columns keep every filter but not the page.
  const listParams = withoutPage(params);
  const menu = listDisplayMenu(displaySpec, listParams, savedViews);
  const display = parseListDisplay(displaySpec, listParams);
  const paged = pageOf(sortRows(filtered, display), state.page);
  const sections = groupRows(paged.rows, display.groupBy);
  const filters = companyColumnFilters(params, state, companies);
  const count = companiesCount(state, filtered.length, companies.length, params.q);
  const searchedOut = filtered.length === 0 && state.terms.length > 0 && !narrowed;

  return (
    <PageWide>
      <PageHeader
        subject={sectionSubject('/jobs/companies', 'Companies')}
        title="Companies"
        actions={
          <>
            <DisplayMenu menu={menu} />
            <AddCompany />
          </>
        }
      />

      {showTargets && (
        <section className="mb-6" aria-label="Targets">
          <SectionHeading title="Targets" count={targets.length} className="mb-2" />
          {targets.length === 0 ? (
            <p className="text-ui text-ink-muted">
              No targets yet. Open a company you most want and mark it Target on its Perspective
              tab.
            </p>
          ) : (
            <Card className="overflow-hidden">
              {/* A phone gets two lines a target, as the list below does. */}
              <ul className="divide-y divide-border md:hidden">
                {targets.map(({ company, answered, nextMove }) => (
                  <li key={company.id}>
                    <RowLink
                      href={`/jobs/companies/${company.slug}?tab=perspective`}
                      className="group block row-pad px-4 hover:bg-sunken"
                    >
                      <span className="block text-ui font-medium text-ink group-hover:text-accent">
                        <CompanyName company={company} />
                      </span>
                      <span className="tabular mt-1 block truncate pl-7 text-small text-ink-muted">
                        {answered} of {PERSPECTIVE_QUESTIONS.length} answered ·{' '}
                        {nextMove.trim() || 'no next move yet'}
                      </span>
                    </RowLink>
                  </li>
                ))}
              </ul>
              <div className="max-md:hidden">
                <Table>
                  <THead>
                    <TR>
                      <TH>Company</TH>
                      <TH>Your view</TH>
                      <TH>Next move</TH>
                      <TH>Updated</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {targets.map(({ company, answered, nextMove }) => (
                      <TR key={company.id} href={`/jobs/companies/${company.slug}?tab=perspective`}>
                        <TD primary>
                          <CompanyName company={company} />
                        </TD>
                        <TD label="Your view" muted>
                          <span className="tabular">
                            {answered} of {PERSPECTIVE_QUESTIONS.length}
                          </span>
                        </TD>
                        <TD label="Next move" muted>
                          {nextMove.trim() ? (
                            <span className="line-clamp-2">{nextMove}</span>
                          ) : (
                            'None yet'
                          )}
                        </TD>
                        <TD label="Updated" muted>
                          <span className="tabular">
                            {company.perspective_updated_at
                              ? formatDate(company.perspective_updated_at, timezone)
                              : 'Never'}
                          </span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          )}
        </section>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail active={filterNames(state).length}>
          <RailGroup label="Priority">
            <RailItem
              label="All"
              href={href({ priority: undefined })}
              active={!state.priority}
              count={companies.length}
            />
            {COMPANY_PRIORITIES.map((entry) => (
              <RailItem
                key={entry}
                label={entry}
                href={href({ priority: entry })}
                active={state.priority === entry}
                count={companies.filter((c) => c.priority === entry).length}
              />
            ))}
          </RailGroup>

          <RailGroup label="Pursuing">
            <RailItem
              label="In process or beyond"
              href={href({ active: state.activeOnly ? undefined : '1' })}
              active={state.activeOnly}
              count={companies.filter(isActiveCompany).length}
            />
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1">
          {duplicates.length > 0 && (
            <Banner tone="warn" className="mb-4">
              <div className="space-y-1">
                <p>
                  {duplicates.length === 1
                    ? 'These two look like the same company.'
                    : `${duplicates.length} pairs look like the same company.`}{' '}
                  Open the one to keep and use Merge to fold the other into it.
                </p>
                <ul className="text-small">
                  {duplicates.map(({ a, b, reason }) => (
                    <li key={`${a.id}-${b.id}`}>
                      <Link href={`/jobs/companies/${a.slug}`}>{a.name}</Link> and{' '}
                      <Link href={`/jobs/companies/${b.slug}`}>{b.name}</Link>
                      <span className="text-ink-muted">
                        {' '}
                        ·{' '}
                        {reason === 'board'
                          ? 'same job board'
                          : reason === 'domain'
                            ? 'same domain'
                            : 'same name'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Banner>
          )}

          {/* Directly above the table it narrows, like every other list in the
              app. Every filter, the sort and the page are on the URL and the
              field carries them, so searching a narrowed table stays narrowed. */}
          <div className="mb-4">
            <SearchField placeholder="Search name, location or domain" />
          </div>

          {searchedOut ? (
            <SearchEmpty query={params.q ?? ''} />
          ) : filtered.length === 0 ? (
            // The header stays, so a filter can be loosened from its column.
            <Card className="overflow-hidden">
              <CompaniesTable
                rows={[]}
                sorts={menu.sorts}
                defaultSort={displaySpec.defaultSort}
                hidden={display.hidden}
                filters={filters}
                openColumn={openColumn}
              />
              <div className="border-border px-4 py-10 text-center md:border-t">
                <p className="text-body font-medium text-ink">No rows match these filters</p>
                <p className="mt-1 text-small text-ink-muted">{filterNames(state).join(' · ')}</p>
                <Link
                  href={clearFiltersHref(params)}
                  className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-4')}
                >
                  Clear filters
                </Link>
              </div>
            </Card>
          ) : (
            <div className="space-y-5">
              {
                /* ui-ok: one card per group of rows, each holding its rows as one table, not a card per row */ sections.map(
                  (section) => (
                    <div key={section.key} className="space-y-2">
                      {display.group !== NO_GROUP && (
                        <GroupHeader label={section.label} count={section.count} />
                      )}
                      <Card className="overflow-hidden">
                        <CompaniesTable
                          rows={section.rows}
                          sorts={menu.sorts}
                          defaultSort={displaySpec.defaultSort}
                          hidden={display.hidden}
                          filters={filters}
                          openColumn={section === sections[0] ? openColumn : undefined}
                        />
                      </Card>
                    </div>
                  ),
                )
              }
              <nav aria-label="Pages" className="flex items-center justify-between gap-3">
                <span className="tabular text-small text-ink-muted">
                  {paged.pages > 1 ? `${paged.first}–${paged.last} · ${count}` : count}
                </span>
                {paged.pages > 1 && (
                  <span className="flex gap-2">
                    {paged.page > 1 && (
                      <Link
                        href={href({ page: String(paged.page - 1) })}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Previous
                      </Link>
                    )}
                    {paged.page < paged.pages && (
                      <Link
                        href={href({ page: String(paged.page + 1) })}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Next
                      </Link>
                    )}
                  </span>
                )}
              </nav>
            </div>
          )}
        </div>
      </div>
    </PageWide>
  );
}

/** Narrowed to a priority from the rail or its column, and nothing else. */
function hasOnlyPriority(params: CompaniesParams): boolean {
  return (
    !params.active &&
    !params.name &&
    !params.activity &&
    !params.roles &&
    !params.domains &&
    !params.domain
  );
}

function CompanyName({ company, location = false }: { company: CompanyRow; location?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <CompanyAvatar
        company={{
          name: company.name,
          logoUrl: company.logo_url,
          domains: company.domains,
          website: company.website,
          careersUrl: company.careers_url,
        }}
        className="size-5 rounded-control"
        imageClassName="size-4"
      />
      <span className="min-w-0 truncate">
        {company.name}
        {location && company.hq_location && (
          <span className="ml-1.5 font-normal text-ink-muted">{company.hq_location}</span>
        )}
      </span>
    </span>
  );
}

/** The column headers, in the order the table draws them, with what each is called. */
const COLUMNS = [
  { id: 'name', label: 'Company' },
  { id: 'priority', label: 'Priority' },
  { id: 'activity', label: 'Activity' },
  { id: 'roles', label: 'Roles', num: true },
  { id: 'domains', label: 'Domains' },
] as const;

/**
 * A header's sort, drawn as chosen only when the person chose it: the sort
 * the table opens on is a default, and a default is drawn plain (law 17), so
 * the accent is left to what was changed.
 */
function headerSort(
  sort: DisplayChoice | undefined,
  defaultSort: string | undefined,
): DisplayChoice | undefined {
  return sort && sort.id === defaultSort ? { ...sort, chosen: false } : sort;
}

function CompaniesTable({
  rows,
  sorts,
  defaultSort,
  hidden,
  filters,
  openColumn,
}: {
  rows: readonly CompanyRow[];
  /** The Display panel's sort links, so a header and the panel agree. */
  sorts: readonly DisplayChoice[];
  /** The sort the table opens on, whose header stays grey (law 17). */
  defaultSort?: string;
  hidden: readonly string[];
  filters: Readonly<Record<string, ColumnFilter>>;
  openColumn?: string;
}) {
  const showing = (id: string) => id === 'name' || !hidden.includes(id);
  return (
    <>
      {/* A phone gets a short row a company: the name and place, then the
       * facts on one grey line (law 9), as Pipeline's table does. */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((company) => (
          <CompanyLine key={company.id} company={company} showing={showing} />
        ))}
      </ul>
      <div className="max-md:hidden">
        <Table>
          <THead>
            <TR>
              {COLUMNS.filter((column) => showing(column.id)).map((column) => (
                <TH
                  key={column.id}
                  num={'num' in column && column.num}
                  // The name takes the room the short columns leave, and is
                  // cut to one line rather than wrapped.
                  className={column.id === 'name' ? 'w-full' : 'whitespace-nowrap'}
                >
                  <ColumnHeading
                    sort={headerSort(
                      sorts.find((entry) => entry.id === column.id),
                      defaultSort,
                    )}
                    label={column.label}
                    filter={filters[column.id]}
                    open={openColumn === column.id}
                  />
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((company) => (
              <TR key={company.id} href={`/jobs/companies/${company.slug}`}>
                <TD primary className="max-w-0">
                  <CompanyName company={company} location />
                </TD>
                {showing('priority') && (
                  <TD label="Priority" muted className="whitespace-nowrap">
                    {company.priority}
                  </TD>
                )}
                {showing('activity') && (
                  <TD label="Activity" muted className="whitespace-nowrap">
                    {company.status.replace(/_/g, ' ')}
                  </TD>
                )}
                {showing('roles') && (
                  <TD label="Roles" num muted>
                    {company.roles.length}
                  </TD>
                )}
                {showing('domains') && (
                  <TD label="Domains" muted>
                    <span className="block max-w-48 truncate">
                      {company.domains.length > 0 ? company.domains.join(', ') : '—'}
                    </span>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}

function CompanyLine({
  company,
  showing,
}: {
  company: CompanyRow;
  showing: (id: string) => boolean;
}) {
  const facts = [
    showing('priority') ? company.priority : null,
    showing('activity') ? company.status.replace(/_/g, ' ') : null,
    showing('roles')
      ? `${company.roles.length} ${company.roles.length === 1 ? 'role' : 'roles'}`
      : null,
    showing('domains') && company.domains.length > 0 ? company.domains[0] : null,
  ].filter(Boolean);
  return (
    <li>
      {/* The whole row is the link, so it is a full-height press target. */}
      <RowLink
        href={`/jobs/companies/${company.slug}`}
        className="group block row-pad px-4 hover:bg-sunken"
      >
        <span className="block text-ui font-medium text-ink group-hover:text-accent">
          <CompanyName company={company} location />
        </span>
        {facts.length > 0 && (
          <span className="tabular mt-1 block truncate pl-7 text-small text-ink-muted">
            {facts.join(' · ')}
          </span>
        )}
      </RowLink>
    </li>
  );
}
