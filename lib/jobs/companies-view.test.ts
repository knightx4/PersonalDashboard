import { describe, expect, it } from 'vitest';
import {
  clearFiltersHref,
  companiesHref,
  companyColumnFilters,
  filterCompanies,
  hasColumnFilters,
  parseCompanies,
  type CompanyRow,
} from './companies-view';

function company(overrides: Partial<CompanyRow>): CompanyRow {
  return {
    id: overrides.slug ?? 'x',
    name: 'Acme',
    slug: 'acme',
    priority: 'interested',
    status: 'no_activity',
    industry: null,
    hq_location: null,
    domains: [],
    website: null,
    careers_url: null,
    logo_url: null,
    ats_type: 'unknown',
    ats_board_token: null,
    perspective_updated_at: null,
    roles: [],
    ...overrides,
  };
}

const rows = [
  company({
    slug: 'acme',
    name: 'Acme',
    priority: 'target',
    status: 'active',
    domains: ['acme.com'],
    hq_location: 'London',
    roles: [{ id: 'r1', applications: [{ status: 'in_process' }] }],
  }),
  company({ slug: 'globex', name: 'Globex', priority: 'backup', domains: [] }),
  company({
    slug: 'initech',
    name: 'Initech',
    priority: 'target',
    status: 'closed_out',
    domains: ['initech.io'],
    roles: [{ id: 'r2', applications: [{ status: 'rejected' }] }],
  }),
];

const slugs = (params: Parameters<typeof parseCompanies>[0]) =>
  filterCompanies(rows, parseCompanies(params)).map((row) => row.slug);

describe('filterCompanies', () => {
  it('narrows by each column', () => {
    expect(slugs({ priority: 'target' })).toEqual(['acme', 'initech']);
    expect(slugs({ activity: 'closed_out' })).toEqual(['initech']);
    expect(slugs({ roles: 'none' })).toEqual(['globex']);
    expect(slugs({ domains: 'none' })).toEqual(['globex']);
    expect(slugs({ name: 'lond' })).toEqual(['acme']);
    expect(slugs({ domain: '.io' })).toEqual(['initech']);
    expect(slugs({ active: '1' })).toEqual(['acme']);
  });

  it('ignores values it does not know', () => {
    expect(slugs({ priority: 'nope', activity: 'busy', roles: 'many' })).toHaveLength(3);
    expect(hasColumnFilters(parseCompanies({ priority: 'nope' }))).toBe(false);
  });
});

describe('companiesHref', () => {
  it('keeps the other params, drops the page and the default view', () => {
    expect(
      companiesHref({ priority: 'target', page: '3', sort: 'priority' }, { activity: 'active' }),
    ).toBe('/jobs/companies?priority=target&sort=priority&activity=active');
    expect(companiesHref({ view: 'focus' }, {})).toBe('/jobs/companies');
    expect(companiesHref({ view: 'table' }, {})).toBe('/jobs/companies?view=table');
  });

  it('clears every filter and keeps the arrangement', () => {
    expect(
      clearFiltersHref({
        priority: 'target',
        name: 'ac',
        q: 'x',
        domains: 'none',
        sort: 'priority',
      }),
    ).toBe('/jobs/companies?sort=priority');
  });

  it('clears the filters in the view they were set in', () => {
    expect(clearFiltersHref({ priority: 'target' })).toBe('/jobs/companies');
    expect(clearFiltersHref({ view: 'table', priority: 'target' })).toBe(
      '/jobs/companies?view=table',
    );
  });
});

describe('companyColumnFilters', () => {
  it('gives every column a menu, marks the filtered ones, and counts each choice', () => {
    const params = { priority: 'target', domain: 'acme' };
    const filters = companyColumnFilters(params, parseCompanies(params), rows);
    expect(Object.keys(filters)).toEqual(['name', 'priority', 'activity', 'roles', 'domains']);
    expect(filters.priority.active).toBe(true);
    expect(filters.domains.active).toBe(true);
    expect(filters.activity.active).toBe(false);
    expect(filters.name.typed?.param).toBe('name');
    expect(filters.priority.choices.find((c) => c.id === 'priority-target')).toMatchObject({
      label: 'Target · 2',
      current: true,
    });
    expect(filters.roles.choices.find((c) => c.id === 'roles-none')?.href).toBe(
      '/jobs/companies?priority=target&domain=acme&roles=none',
    );
  });
});

describe('the views', () => {
  it('opens on the focused view, whatever is filtered, unless the address names the table', () => {
    expect(parseCompanies({}).view).toBe('focus');
    expect(parseCompanies({ view: 'board' }).view).toBe('focus');
    expect(parseCompanies({ priority: 'target' }).view).toBe('focus');
    expect(parseCompanies({ view: 'table', priority: 'target' }).view).toBe('table');
  });

  it('keeps the view a column menu is opened from', () => {
    const params = { view: 'table' };
    const filters = companyColumnFilters(params, parseCompanies(params), rows);
    expect(filters.roles.choices.find((c) => c.id === 'roles-none')?.href).toBe(
      '/jobs/companies?view=table&roles=none',
    );
  });
});
