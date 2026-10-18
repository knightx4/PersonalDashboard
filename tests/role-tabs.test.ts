import { describe, expect, it } from 'vitest';
import {
  ROLE_TABS,
  defaultRoleTab,
  roleTabFrom,
  roleTabSearch,
} from '@/app/jobs/(app)/roles/[id]/tabs';
import { originLabel, originMessageHref } from '@/app/jobs/(app)/roles/[id]/role-facts';
import type { FactCertainty, FactOrigin, FactOriginRecord } from '@/lib/jobs/fact-origins';

describe('the role page tab in the address', () => {
  it('reads every tab from its own ?tab= value', () => {
    for (const tab of ROLE_TABS) expect(roleTabFrom(tab)).toBe(tab);
  });

  it('keeps the old ids that links were written with', () => {
    expect(roleTabFrom('answers')).toBe('answers');
    expect(roleTabFrom('notes')).toBe('notes');
  });

  it('names no tab for a value that is not one, or none', () => {
    expect(roleTabFrom('comments')).toBeUndefined();
    expect(roleTabFrom(null)).toBeUndefined();
    expect(roleTabFrom(undefined)).toBeUndefined();
  });

  it('opens each stage on what it needs (plan #1594)', () => {
    expect(defaultRoleTab('lead')).toBe('posting');
    expect(defaultRoleTab('drafting')).toBe('answers');
    expect(defaultRoleTab('submitted')).toBe('timeline');
    expect(defaultRoleTab('acknowledged')).toBe('timeline');
    expect(defaultRoleTab('in_process')).toBe('interviews');
    expect(defaultRoleTab('final_round')).toBe('interviews');
    expect(defaultRoleTab('offer')).toBe('interviews');
    for (const closed of ['rejected', 'withdrawn', 'ghosted', 'role_closed'] as const) {
      expect(defaultRoleTab(closed)).toBe('timeline');
    }
  });

  it('writes the tab and keeps the other parameters', () => {
    expect(roleTabSearch('', 'posting')).toBe('?tab=posting');
    expect(roleTabSearch('tab=timeline&from=board', 'mail')).toBe('?tab=mail&from=board');
  });

  it('drops the interview to scroll to once you leave the Interviews tab', () => {
    expect(roleTabSearch('tab=interviews&interview=i1', 'posting')).toBe('?tab=posting');
    expect(roleTabSearch('interview=i1', 'interviews')).toBe('?interview=i1&tab=interviews');
  });

  it('drops the message a fact came from once you leave the Mail tab (plan #2343.3)', () => {
    expect(roleTabSearch('tab=mail&message=m1', 'timeline')).toBe('?tab=timeline');
    expect(roleTabSearch('tab=mail&message=m1', 'mail')).toBe('?tab=mail&message=m1');
  });
});

describe('the origin label on a role fact (plan #2343.3)', () => {
  const record = (origin: FactOrigin, certainty: FactCertainty | null): FactOriginRecord => ({
    field: 'comp',
    origin,
    certainty,
    messageId: null,
    sourceUrl: null,
    recordedAt: '',
  });

  it('names each known source and says nothing for an unknown or missing one', () => {
    expect(originLabel(record('posting', 'firsthand'))).toBe('Posting');
    expect(originLabel(record('you', 'firsthand'))).toBe('You');
    expect(originLabel(record('recruiter_email', 'secondhand'))).toBe('Recruiter email');
    expect(originLabel(record('dash', 'guess'))).toBe('Dash guess');
    expect(originLabel(record('dash', 'secondhand'))).toBe('Dash');
    expect(originLabel(record('unknown', null))).toBeNull();
    expect(originLabel(null)).toBeNull();
  });

  it('links a secondhand fact to its message on the Mail tab', () => {
    expect(originMessageHref('r1', 'm1')).toBe('/jobs/roles/r1?tab=mail&message=m1');
  });
});
