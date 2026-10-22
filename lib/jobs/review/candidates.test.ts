import { describe, expect, it } from 'vitest';
import type { LinkCandidate } from '@/lib/jobs/email/link';
import type { ReviewMessageRow, ReviewRow } from '@/lib/jobs/review/load';
import { rankLinkCandidates, searchableRoles, withLinkCandidates } from '@/lib/jobs/review/candidates';

function candidate(over: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    applicationId: 'app-1',
    roleId: 'role-1',
    companyId: 'co-1',
    companyName: 'Canonical',
    companyDomains: ['canonical.com'],
    roleTitle: 'Engineering Manager',
    atsJobId: null,
    submittedAt: new Date('2026-10-01'),
    createdAt: new Date('2026-10-01'),
    status: 'applied',
    attempt: 1,
    threadIds: [],
    ...over,
  };
}

function message(over: Partial<ReviewMessageRow> = {}): ReviewMessageRow {
  return {
    kind: 'message',
    id: 'msg-1',
    subject: 'Your application',
    fromAddress: 'someone@nowhere.example',
    threadId: null,
    replyToAddress: null,
    roleHint: null,
    receivedAt: '2026-10-20T10:00:00Z',
    classification: 'other',
    reason: 'Held',
    gmailHref: null,
    candidates: [],
    sortAt: '2026-10-20T10:00:00Z',
    ...over,
  };
}

describe('the review rows the Review page and the Inbox share', () => {
  it('ranks the pursuit on the same thread first, with its reason', () => {
    const ranked = rankLinkCandidates(message({ threadId: 't-9' }), [
      candidate({ applicationId: 'other', companyName: 'Other', companyDomains: [] }),
      candidate({ applicationId: 'same-thread', threadIds: ['t-9'] }),
    ]);
    expect(ranked[0].applicationId).toBe('same-thread');
    expect(ranked[0].label).toBe('Canonical · Engineering Manager');
    expect(ranked[0].confidence).toBeGreaterThan(0);
  });

  it('offers the three most recent pursuits when nothing matches', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id) =>
      candidate({ applicationId: id, companyName: `Co ${id}`, companyDomains: [] }),
    );
    const ranked = rankLinkCandidates(message(), pool);
    expect(ranked.map((entry) => entry.applicationId)).toEqual(['a', 'b', 'c']);
    expect(ranked.every((entry) => entry.confidence === null)).toBe(true);
  });

  it('fills candidates on messages only', () => {
    const event = { kind: 'event', id: 'e' } as unknown as ReviewRow;
    const rows = withLinkCandidates([message(), event], [candidate()]);
    expect(rows[0].kind === 'message' && rows[0].candidates).toHaveLength(1);
    expect(rows[1]).toBe(event);
  });

  it('lists every pursuit by company then title for the search', () => {
    const roles = searchableRoles([
      candidate({ applicationId: '2', companyName: 'Zeta', roleTitle: 'A' }),
      candidate({ applicationId: '1', companyName: 'Alpha', roleTitle: 'B', submittedAt: null }),
    ]);
    expect(roles.map((role) => role.applicationId)).toEqual(['1', '2']);
    expect(roles[0].everSubmitted).toBe(false);
  });
});
