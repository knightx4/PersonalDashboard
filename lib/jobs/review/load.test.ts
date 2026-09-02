import { describe, expect, it } from 'vitest';
import { matchRoles, type SearchableRole } from '@/lib/jobs/review/load';

const role = (companyName: string, roleTitle: string): SearchableRole => ({
  applicationId: `${companyName}-${roleTitle}`,
  companyName,
  roleTitle,
  status: 'in_process',
  everSubmitted: true,
});

const ROLES: SearchableRole[] = [
  role('Canonical', 'Engineering Manager'),
  role('Canonical', 'Product Lead'),
  role('Columbus Health', 'UBS Liaison'),
  role('UBS', 'Analyst'),
];

describe('searching all roles from the review queue', () => {
  it('offers everything, capped, before anything is typed', () => {
    expect(matchRoles(ROLES, '', 2)).toHaveLength(2);
    expect(matchRoles(ROLES, '   ')).toHaveLength(4);
  });

  it('matches on the company name', () => {
    const found = matchRoles(ROLES, 'canonical');
    expect(found).toHaveLength(2);
    expect(found.every((r) => r.companyName === 'Canonical')).toBe(true);
  });

  it('matches on the role title', () => {
    expect(matchRoles(ROLES, 'analyst').map((r) => r.companyName)).toEqual(['UBS']);
  });

  it('narrows on every term, across both fields', () => {
    expect(matchRoles(ROLES, 'canonical eng').map((r) => r.roleTitle)).toEqual([
      'Engineering Manager',
    ]);
  });

  it('puts a name you typed the start of above one that merely contains it', () => {
    expect(matchRoles(ROLES, 'ubs')[0].companyName).toBe('UBS');
  });

  it('ignores case and returns nothing rather than guessing', () => {
    expect(matchRoles(ROLES, 'CANONICAL')).toHaveLength(2);
    expect(matchRoles(ROLES, 'stripe')).toEqual([]);
  });
});
