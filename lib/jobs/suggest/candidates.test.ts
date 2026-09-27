import { describe, expect, it } from 'vitest';
import { pickReachOutCandidates, type ApplicationFact, type ContactFact } from './candidates';

const NOW = new Date('2026-09-27T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function contact(over: Partial<ContactFact> = {}): ContactFact {
  return {
    id: 'k1',
    name: 'Priya Shah',
    title: 'Recruiter',
    relationship: 'recruiter',
    status: 'responded',
    howWeConnect: null,
    notes: null,
    companyId: 'acme',
    hasEmail: true,
    hasLinkedin: false,
    lastTouchAt: null,
    ...over,
  };
}

function app(over: Partial<ApplicationFact> = {}): ApplicationFact {
  return {
    companyId: 'acme',
    companyName: 'Acme',
    roleTitle: 'Data Analyst',
    status: 'in_process',
    submittedAt: daysAgo(10),
    lastEventAt: daysAgo(3),
    lastEventSummary: 'Screen booked',
    ...over,
  };
}

describe('pickReachOutCandidates', () => {
  it('puts someone at a company where an interview is under way first', () => {
    const picked = pickReachOutCandidates(
      {
        contacts: [
          contact({ id: 'cold', name: 'Sam Old', companyId: 'globex' }),
          contact({ id: 'live', name: 'Priya Shah' }),
        ],
        applications: [app(), app({ companyId: 'globex', companyName: 'Globex', status: 'rejected', lastEventAt: daysAgo(5) })],
        past: [],
      },
      NOW,
    );
    expect(picked[0]).toMatchObject({ ref: 'c1', contactId: 'live', companyName: 'Acme' });
    expect(picked[0].facts.join('\n')).toContain('Data Analyst at Acme: in process');
  });

  it('leaves out someone messaged in the last two weeks, dormant, or with an open suggestion', () => {
    const picked = pickReachOutCandidates(
      {
        contacts: [
          contact({ id: 'recent', lastTouchAt: daysAgo(3) }),
          contact({ id: 'dormant', status: 'dormant' }),
          contact({ id: 'open' }),
        ],
        applications: [app()],
        past: [{ kind: 'reach_out', status: 'open', contactId: 'open', companyId: 'acme', createdAt: daysAgo(1), actedAt: null }],
      },
      NOW,
    );
    expect(picked.map((c) => c.contactId)).toEqual([]);
  });

  it('offers a dismissed person again only after the rest period', () => {
    const past = (days: number) => [
      { kind: 'reach_out', status: 'dismissed', contactId: 'k1', companyId: 'acme', createdAt: daysAgo(days), actedAt: daysAgo(days) },
    ];
    const input = { contacts: [contact()], applications: [app()] };
    expect(pickReachOutCandidates({ ...input, past: past(10) }, NOW)).toHaveLength(0);
    expect(pickReachOutCandidates({ ...input, past: past(60) }, NOW)).toHaveLength(1);
  });

  it('suggests finding someone at a company with a sent application and nobody on file', () => {
    const picked = pickReachOutCandidates(
      {
        contacts: [],
        applications: [
          app({ companyId: 'initech', companyName: 'Initech', status: 'submitted', submittedAt: daysAgo(5) }),
          app({ companyId: 'hooli', companyName: 'Hooli', status: 'rejected' }),
        ],
        past: [],
      },
      NOW,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ contactId: null, companyId: 'initech', name: null });
  });

  it('keeps at most twelve, numbered in order', () => {
    const contacts = Array.from({ length: 20 }, (_, i) => contact({ id: `k${i}`, name: `Person ${String(i).padStart(2, '0')}` }));
    const picked = pickReachOutCandidates({ contacts, applications: [app()], past: [] }, NOW);
    expect(picked).toHaveLength(12);
    expect(picked.map((c) => c.ref).slice(0, 3)).toEqual(['c1', 'c2', 'c3']);
  });
});
