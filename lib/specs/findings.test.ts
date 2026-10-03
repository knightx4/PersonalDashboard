import { describe, expect, it } from 'vitest';
import { findingChangeHref, groupFindings, specFindingFrom, type SpecFinding } from './findings';

function finding(kind: SpecFinding['kind'], id: string = kind): SpecFinding {
  return {
    id,
    spec: 'plan',
    section: null,
    kind,
    finding: `A ${kind} finding.`,
    evidence: '',
    proposal: 'none',
    change: null,
    auditId: 'a1',
    createdAt: '2026-10-05T09:00:00Z',
  };
}

describe('groupFindings', () => {
  it('groups by kind, what needs doing first and what holds last, leaving out empty kinds', () => {
    const groups = groupFindings([
      finding('holds', 'h1'),
      finding('drifted', 'd1'),
      finding('missing_rule', 'r1'),
      finding('drifted', 'd2'),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['drifted', 'missing_rule', 'holds']);
    expect(groups[0].findings.map((f) => f.id)).toEqual(['d1', 'd2']);
  });

  it('is empty when nothing was found', () => {
    expect(groupFindings([])).toEqual([]);
  });
});

describe('specFindingFrom', () => {
  const row = {
    id: 'f1',
    spec: 'learn',
    section: 'Routes',
    kind: 'drifted' as const,
    finding: 'The route table is out of date.',
    evidence: 'app/learn/page.tsx:22',
    proposal: 'change_spec' as const,
    audit_id: 'a1',
    created_at: '2026-10-05T09:00:00Z',
  };

  it('reads the change it led to, whether embedded as one row or a list', () => {
    const change = { id: 'c1', title: 'Update the routes', status: 'proposed' as const };
    expect(specFindingFrom({ ...row, spec_changes: change }).change).toEqual(change);
    expect(specFindingFrom({ ...row, spec_changes: [change] }).change).toEqual(change);
    expect(specFindingFrom({ ...row, spec_changes: null }).change).toBeNull();
  });
});

describe('findingChangeHref', () => {
  it('links an open change to its card on /dev/specs and a decided one nowhere', () => {
    expect(findingChangeHref({ id: 'c1', title: 't', status: 'proposed' })).toBe(
      '/dev/specs#spec-change-c1',
    );
    expect(findingChangeHref({ id: 'c1', title: 't', status: 'approved' })).toBe(
      '/dev/specs#spec-change-c1',
    );
    expect(findingChangeHref({ id: 'c1', title: 't', status: 'applied' })).toBeNull();
    expect(findingChangeHref({ id: 'c1', title: 't', status: 'declined' })).toBeNull();
  });
});
