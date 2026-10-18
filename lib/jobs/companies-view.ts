import { IN_PROCESS_OR_LATER, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import {
  addressHref,
  choiceColumn,
  columnFilters,
  parsePage,
  parseView,
  type AddressChanges,
  type ColumnFilter,
  type FilterColumn,
  type PageAddress,
} from '@/lib/table-view';

/**
 * What the Companies page shows, read from its address (plan #2341.3).
 *
 * Built on the shared table module (lib/table-view.ts) the way Pipeline is:
 * every filter, the sort, the page and the view are params, so a reload or a
 * link opens the same rows. The rail's Priority and Pursuing set the same
 * params the column headers do. The parsing and filtering are apart from the
 * table, so another view of the page can read the same state.
 */

export const COMPANIES_PATH = '/jobs/companies';

/**
 * The views the page has, as Pipeline's are: focused, the default, which leads
 * with the targets and narrows from the rail beside the table; and the table
 * alone, full width, narrowed from its column headers.
 */
export const COMPANY_VIEWS = ['table', 'focus'] as const;
export type CompaniesViewName = (typeof COMPANY_VIEWS)[number];

export const COMPANY_PRIORITIES = ['target', 'interested', 'backup', 'passed'] as const;
export type CompanyPriority = (typeof COMPANY_PRIORITIES)[number];

/** The activity a company's applications give it (job_search.sync_company_status). */
export const COMPANY_ACTIVITIES = [
  { value: 'active', label: 'Active' },
  { value: 'no_activity', label: 'No activity' },
  { value: 'closed_out', label: 'Closed out' },
] as const;

/** One company as the page loads it. */
export type CompanyRow = {
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
  ats_type: string;
  ats_board_token: string | null;
  perspective_updated_at: string | null;
  roles: Array<{ id: string; applications: Array<{ status: ApplicationStatus }> }>;
};

/** The search params the page reads. Sort, group and hide are the Display panel's. */
export type CompaniesParams = {
  view?: string;
  priority?: string;
  /** `1`: only companies in process or beyond. */
  active?: string;
  q?: string;
  /** Typed in the Company column: the name or the location holds it. */
  name?: string;
  /** A value from COMPANY_ACTIVITIES. */
  activity?: string;
  /** `some` with a role tracked, `none` with none. */
  roles?: string;
  /** `some` with a domain, `none` without one. */
  domains?: string;
  /** Typed in the Domains column: a domain holds it. */
  domain?: string;
  page?: string;
  sort?: string;
  group?: string;
  hide?: string | string[];
};

export type CompaniesState = {
  view: CompaniesViewName;
  priority: CompanyPriority | null;
  activeOnly: boolean;
  terms: string[];
  nameTerms: string[];
  activity: string | null;
  roles: 'some' | 'none' | null;
  domains: 'some' | 'none' | null;
  domainTerms: string[];
  /** One-based. */
  page: number;
};

function someOrNone(value: string | undefined): 'some' | 'none' | null {
  return value === 'some' || value === 'none' ? value : null;
}

export function parseCompanies(params: CompaniesParams): CompaniesState {
  const state: CompaniesState = {
    view: 'focus',
    priority: COMPANY_PRIORITIES.find((p) => p === params.priority) ?? null,
    activeOnly: params.active === '1',
    terms: searchTerms(params.q),
    nameTerms: searchTerms(params.name),
    activity: COMPANY_ACTIVITIES.find((a) => a.value === params.activity)?.value ?? null,
    roles: someOrNone(params.roles),
    domains: someOrNone(params.domains),
    domainTerms: searchTerms(params.domain),
    page: parsePage(params.page),
  };
  state.view = parseView(params.view, COMPANY_VIEWS, 'focus');
  return state;
}

/**
 * In process or beyond: any application there has got that far. Rejected,
 * withdrawn or otherwise closed roles do not count, and neither does one
 * still at submitted, waiting to hear back at all.
 */
export function isActiveCompany(company: Pick<CompanyRow, 'roles'>): boolean {
  return company.roles.some((role) =>
    role.applications.some((application) => IN_PROCESS_OR_LATER.includes(application.status)),
  );
}

/** The filters set besides the search box, in the words a person reads them by. */
export function filterNames(state: CompaniesState): string[] {
  const names: string[] = [];
  if (state.priority) names.push(`Priority: ${state.priority}`);
  if (state.activeOnly) names.push('In process or beyond');
  if (state.nameTerms.length) names.push(`Company: “${state.nameTerms.join(' ')}”`);
  if (state.activity) {
    names.push(
      `Activity: ${COMPANY_ACTIVITIES.find((a) => a.value === state.activity)?.label.toLowerCase()}`,
    );
  }
  if (state.roles) names.push(state.roles === 'some' ? 'With roles' : 'No roles');
  if (state.domains) names.push(state.domains === 'some' ? 'With a domain' : 'Without a domain');
  if (state.domainTerms.length) names.push(`Domain: “${state.domainTerms.join(' ')}”`);
  return names;
}

/** Whether anything narrows the list besides the search box. */
export function hasColumnFilters(state: CompaniesState): boolean {
  return filterNames(state).length > 0;
}

export function filterCompanies<T extends CompanyRow>(
  rows: readonly T[],
  state: CompaniesState,
): T[] {
  return rows.filter(
    (c) =>
      (!state.priority || c.priority === state.priority) &&
      (!state.activeOnly || isActiveCompany(c)) &&
      (state.activity === null || c.status === state.activity) &&
      (state.roles === null || (state.roles === 'some') === c.roles.length > 0) &&
      (state.domains === null || (state.domains === 'some') === c.domains.length > 0) &&
      (state.nameTerms.length === 0 || matchesSearch([c.name, c.hq_location], state.nameTerms)) &&
      (state.domainTerms.length === 0 || matchesSearch(c.domains, state.domainTerms)) &&
      // The domains are in here on purpose: a rejection often arrives from an
      // ATS and the only name you remember is the one in the address.
      (state.terms.length === 0 ||
        matchesSearch([c.name, c.industry, c.hq_location, ...c.domains], state.terms)),
  );
}

const COMPANIES_ADDRESS: PageAddress<CompaniesParams> = {
  path: COMPANIES_PATH,
  defaults: { view: 'focus' },
};

/** The link that changes `changes` and keeps everything else, back to the first page. */
export function companiesHref(
  params: CompaniesParams,
  changes: AddressChanges<CompaniesParams>,
): string {
  return addressHref(COMPANIES_ADDRESS, params, changes);
}

/** The same table with every filter off, the search included; the arrangement stays. */
export function clearFiltersHref(params: CompaniesParams): string {
  return companiesHref(params, {
    priority: undefined,
    active: undefined,
    q: undefined,
    name: undefined,
    activity: undefined,
    roles: undefined,
    domains: undefined,
    domain: undefined,
  });
}

/**
 * The menu each column header opens, by column id. Counts are over every
 * company, as the rail's are, so a choice says how many it holds whatever
 * else is set.
 */
export function companyColumnFilters(
  params: CompaniesParams,
  state: CompaniesState,
  rows: readonly CompanyRow[],
): Record<string, ColumnFilter> {
  // Both views draw the table, so a menu's links stay in the view it is in.
  const href = (changes: AddressChanges<CompaniesParams>) => companiesHref(params, changes);
  const count = (keep: (row: CompanyRow) => boolean) => rows.filter(keep).length;

  const name: FilterColumn<CompaniesParams> = {
    id: 'name',
    active: state.nameTerms.length > 0,
    options: [],
    typed: { param: 'name', placeholder: 'Name or location' },
  };

  const domainColumn = choiceColumn<CompaniesParams>({
    id: 'domains',
    param: 'domains',
    current: state.domains,
    anyLabel: 'Any',
    choices: [
      { value: 'some', label: `With a domain · ${count((c) => c.domains.length > 0)}` },
      { value: 'none', label: `Without a domain · ${count((c) => c.domains.length === 0)}` },
    ],
  });

  return columnFilters<CompaniesParams>(
    [
      name,
      choiceColumn({
        id: 'priority',
        param: 'priority',
        current: state.priority,
        anyLabel: 'Any priority',
        choices: COMPANY_PRIORITIES.map((p) => ({
          value: p,
          label: `${p[0].toUpperCase()}${p.slice(1)} · ${count((c) => c.priority === p)}`,
        })),
      }),
      choiceColumn({
        id: 'activity',
        param: 'activity',
        current: state.activity,
        anyLabel: 'Any activity',
        choices: COMPANY_ACTIVITIES.map(({ value, label }) => ({
          value,
          label: `${label} · ${count((c) => c.status === value)}`,
        })),
      }),
      choiceColumn({
        id: 'roles',
        param: 'roles',
        current: state.roles,
        anyLabel: 'Any',
        choices: [
          { value: 'some', label: `With roles · ${count((c) => c.roles.length > 0)}` },
          { value: 'none', label: `No roles · ${count((c) => c.roles.length === 0)}` },
        ],
      }),
      {
        ...domainColumn,
        active: domainColumn.active || state.domainTerms.length > 0,
        typed: { param: 'domain', placeholder: 'Domain contains' },
      },
    ],
    href,
  );
}

/** The line after the rows: how many are shown, of how many. */
export function companiesCount(
  state: CompaniesState,
  shown: number,
  total: number,
  query?: string,
): string {
  const noun = total === 1 ? 'company' : 'companies';
  if (state.terms.length) return `${shown} of ${total} ${noun} match “${query ?? ''}”.`;
  if (shown === total) return `${total} ${noun}.`;
  return `${shown} of ${total} ${noun} shown.`;
}
