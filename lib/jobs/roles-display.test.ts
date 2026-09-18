import { describe, expect, it } from 'vitest';
import { companiesDisplay, rolesDisplay, type CompanyLike } from './roles-display';
import { groupRows, parseListDisplay, sortRows } from '@/lib/list-display';
import type { PipelineRow } from '@/lib/jobs/applications/load';

/**
 * The roles and companies tables, now that both read their arrangement out of
 * the URL.
 *
 * The property that matters on roles is that the column headers and the
 * Display panel are the same parameter: the header links are built from this
 * declaration, so a sort chosen in one place is the sort marked in the other.
 */

function role(over: Partial<PipelineRow>): PipelineRow {
  return {
    applicationId: 'a1',
    roleId: 'r1',
    roleTitle: 'Engineer',
    companyName: 'Acme',
    companySlug: 'acme',
    companyLogoUrl: null,
    companyDomains: [],
    companyWebsite: null,
    status: 'applied',
    source: 'direct',
    attempt: 1,
    submittedAt: '2024-02-01',
    lastActivityAt: '2024-02-10',
    excitement: 3,
    compMinCents: null,
    compMaxCents: null,
    ...over,
  } as PipelineRow;
}

const spec = rolesDisplay();
const arranged = (params: Record<string, string>) => parseListDisplay(spec, params);

describe('the roles table', () => {
  it('keeps the six sort ids the column headers link to', () => {
    expect(spec.sorts.map((sort) => sort.id)).toEqual([
      'title',
      'company',
      'status',
      'activity',
      'applied',
      'excitement',
    ]);
  });

  it('still opens on last activity', () => {
    expect(arranged({}).sort).toBe('activity');
    const rows = [
      role({ applicationId: 'old', lastActivityAt: '2024-01-01' }),
      role({ applicationId: 'new', lastActivityAt: '2024-03-01' }),
    ];
    expect(sortRows(rows, arranged({})).map((row) => row.applicationId)).toEqual(['new', 'old']);
  });

  it('does not group until asked', () => {
    expect(arranged({}).group).toBe('none');
  });

  it('groups by company', () => {
    const rows = [role({ companyName: 'Zeta', companySlug: 'zeta' }), role({})];
    const groups = groupRows(rows, arranged({ group: 'company' }).groupBy);
    expect(groups.map((group) => group.label)).toEqual(['Acme', 'Zeta']);
  });

  it('never offers to hide the role title', () => {
    expect(spec.properties?.find((property) => property.id === 'title')?.alwaysOn).toBe(true);
  });

  it('hides a column it was asked to hide', () => {
    expect(arranged({ hide: 'comp,excitement' }).hidden).toEqual(['excitement', 'comp']);
  });
});

describe('the companies table', () => {
  function company(over: Partial<CompanyLike>): CompanyLike {
    return { name: 'Acme', priority: 'interested', status: 'in_process', ...over };
  }

  const companies = companiesDisplay<CompanyLike>();
  const asked = (params: Record<string, string>) => parseListDisplay(companies, params);

  it('opens sorted by name, as the query always returned it', () => {
    expect(asked({}).sort).toBe('name');
  });

  it('sorts by priority in the order the rail lists them', () => {
    const rows = [
      company({ name: 'Backup co', priority: 'backup' }),
      company({ name: 'Target co', priority: 'target' }),
      company({ name: 'Passed co', priority: 'passed' }),
    ];
    expect(sortRows(rows, asked({ sort: 'priority' })).map((row) => row.priority)).toEqual([
      'target',
      'backup',
      'passed',
    ]);
  });

  it('groups by priority, highest first', () => {
    const rows = [
      company({ name: 'Backup co', priority: 'backup' }),
      company({ name: 'Target co', priority: 'target' }),
    ];
    const groups = groupRows(rows, asked({ group: 'priority' }).groupBy);
    expect(groups.map((group) => group.label)).toEqual(['target', 'backup']);
    expect(groups[0].count).toBe(1);
  });
});
