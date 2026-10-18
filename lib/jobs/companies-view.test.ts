import { describe, expect, it } from 'vitest';
import {
  clearFiltersHref,
  companiesHref,
  companyColumnFilters,
  filterCompanies,
  focusHref,
  focusIndex,
  hasColumnFilters,
  tableHref,
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
    ).toBe('/jobs/companies?sort=priority&view=table');
  });

  it('clears the filters of the table onto the table', () => {
    expect(clearFiltersHref({ priority: 'target' })).toBe('/jobs/companies?view=table');
    expect(clearFiltersHref({ view: 'focus', priority: 'target' })).toBe('/jobs/companies');
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
      '/jobs/companies?priority=target&domain=acme&view=table&roles=none',
    );
  });
});

describe('the focused view (plan #2341.4)', () => {
  it('reads focus from the address', () => {
    expect(parseCompanies({ view: 'focus' }).view).toBe('focus');
    expect(parseCompanies({ view: 'focus', company: 'acme' }).company).toBe('acme');
    expect(parseCompanies({ company: '  ' }).company).toBeNull();
  });

  it('opens on a company with the filters and sort kept and the page dropped', () => {
    expect(focusHref({ priority: 'target', sort: 'priority', page: '2' }, 'acme')).toBe(
      '/jobs/companies?priority=target&sort=priority&view=focus&company=acme',
    );
    expect(tableHref({ view: 'focus', company: 'acme', priority: 'target' })).toBe(
      '/jobs/companies?view=table&priority=target',
    );
  });

  it('starts on the named company, or the first when it is filtered out', () => {
    const list = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
    expect(focusIndex(list, 'b')).toBe(1);
    expect(focusIndex(list, 'gone')).toBe(0);
    expect(focusIndex(list, null)).toBe(0);
  });

  it('leaves the focused company behind from a column menu', () => {
    const params = { view: 'focus', company: 'acme' };
    const filters = companyColumnFilters(params, parseCompanies(params), rows);
    expect(filters.roles.choices.find((c) => c.id === 'roles-none')?.href).toBe(
      '/jobs/companies?view=table&roles=none',
    );
  });
});

describe('the view switch and the opening view (plan #2341.5)', () => {
  it('opens on the focused view, falling back to it for a view it does not have', () => {
    expect(parseCompanies({}).view).toBe('focus');
    expect(parseCompanies({ view: 'board' }).view).toBe('focus');
    expect(parseCompanies({ q: 'acme' }).view).toBe('focus');
    expect(parseCompanies({ view: 'table' }).view).toBe('table');
  });

  it('opens on the table when a column or rail filter is in the address', () => {
    for (const params of [
      { priority: 'target' },
      { active: '1' },
      { name: 'ac' },
      { activity: 'active' },
      { roles: 'none' },
      { domains: 'some' },
      { domain: '.io' },
    ]) {
      expect(parseCompanies(params).view).toBe('table');
    }
  });

  it('lets an address name the focused view even with a filter, as a saved view does', () => {
    expect(parseCompanies({ view: 'focus', priority: 'target' }).view).toBe('focus');
  });

  it('keeps view=focus in a link only while a filter is set', () => {
    expect(focusHref({}, 'acme')).toBe('/jobs/companies?company=acme');
    expect(focusHref({ priority: 'target' })).toBe('/jobs/companies?priority=target&view=focus');
    expect(focusHref({ priority: 'target', view: 'focus' })).toBe(
      '/jobs/companies?priority=target&view=focus',
    );
    expect(focusHref({ sort: 'priority', view: 'table' })).toBe('/jobs/companies?sort=priority');
  });
});
