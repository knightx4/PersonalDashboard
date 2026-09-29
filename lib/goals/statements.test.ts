import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import type { CollectionRecord } from '@/lib/goals/collections-store';
import type { LearnedKind } from '@/lib/goals/document-kinds';
import {
  checkChange,
  gmailQuery,
  ordinaryLimit,
  statementLines,
  statementSources,
} from '@/lib/goals/statements';

// The loans collection as it stands on the live account (plan #1023).
const FIELDS: CollectionField[] = [
  { key: 'name', type: 'text', label: 'Loan' },
  { key: 'servicer', type: 'text', label: 'Servicer' },
  { key: 'balance', type: 'money', label: 'Balance', tracked: true },
  { key: 'rate', type: 'percent', label: 'Interest rate' },
  { key: 'minimum', type: 'money', label: 'Minimum payment' },
  { key: 'loan_id', type: 'text', label: 'Loan ID', id: true },
  {
    key: 'status',
    type: 'choice',
    label: 'Status',
    options: ['In school', 'Grace period', 'Deferred', 'Repayment', 'Paid off'],
  },
  { key: 'principal', type: 'money', label: 'Principal', tracked: true },
  { key: 'interest', type: 'money', label: 'Unpaid interest', tracked: true },
  { key: 'as_of', type: 'date', label: 'Figures as of' },
  { key: 'next_due', type: 'date', label: 'Next payment due' },
];

const GRAD_PLUS = {
  name: 'Grad PLUS 2024–25',
  servicer: 'Edfinancial',
  balance: 80080.21,
  rate: 9.08,
  minimum: 988,
  loan_id: '*****8042P25G01426001',
  status: 'Deferred',
  principal: 68610,
  interest: 11470.21,
  next_due: '2026-12-18',
};

function record(over: Partial<CollectionRecord>): CollectionRecord {
  return {
    id: 'r1',
    collectionId: 'c1',
    data: GRAD_PLUS,
    version: 1,
    position: 0,
    source: 'pasted',
    sourceRef: null,
    draft: false,
    asOf: null,
    updatedAt: '2026-09-25T10:00:00Z',
    ...over,
  };
}

function kind(over: Partial<LearnedKind>): LearnedKind {
  return {
    id: 'k1',
    collectionId: 'c1',
    name: 'Edfinancial statement',
    recognise: '',
    fieldNotes: {},
    skipped: [],
    senders: ['Edfinancial', 'edfinancial.com'],
    lastReadAt: null,
    ...over,
  };
}

const LOANS = { id: 'c1', name: 'loans', shape: 'list' as const, fields: FIELDS };

describe('ordinaryLimit', () => {
  it("is a month's payment plus a month's interest on the balance", () => {
    // 988 + 80,080.21 × 9.08% / 12 = 988 + 605.94
    expect(ordinaryLimit(FIELDS, GRAD_PLUS)).toBe(1593.94);
  });

  it('is only the interest when no payment is set', () => {
    const unsub = {
      ...GRAD_PLUS,
      minimum: null,
      balance: 23549.6,
      principal: 20500,
      interest: 3049.6,
      rate: 8.08,
    };
    expect(ordinaryLimit(FIELDS, unsub)).toBe(158.57);
  });

  it('is null when the row has no tracked money value', () => {
    expect(ordinaryLimit(FIELDS, { loan_id: 'x' })).toBeNull();
  });
});

describe('checkChange', () => {
  it('lets a month of interest and a new due date through', () => {
    const after = {
      balance: 80686.15,
      interest: 12076.15,
      next_due: '2027-01-18',
      as_of: '2026-10-02',
    };
    expect(checkChange(FIELDS, GRAD_PLUS, after)).toEqual({ ordinary: true });
  });

  it('lets a payment through', () => {
    expect(checkChange(FIELDS, GRAD_PLUS, { balance: 79092.21 })).toEqual({ ordinary: true });
  });

  it('holds a balance that moved by more than a payment and interest', () => {
    const check = checkChange(FIELDS, GRAD_PLUS, { balance: 70080.21 });
    expect(check.ordinary).toBe(false);
    if (!check.ordinary) expect(check.reason).toContain('Balance moved by $10,000.00');
  });

  it('holds a change of status or payment amount', () => {
    expect(checkChange(FIELDS, GRAD_PLUS, { status: 'Repayment' }).ordinary).toBe(false);
    expect(checkChange(FIELDS, GRAD_PLUS, { minimum: 1020 }).ordinary).toBe(false);
  });

  it('ignores values that did not change or that the statement left out', () => {
    expect(checkChange(FIELDS, GRAD_PLUS, { status: 'Deferred', rate: null })).toEqual({
      ordinary: true,
    });
  });
});

describe('gmailQuery', () => {
  it('searches one sender, or several joined with OR, quoting names with a space', () => {
    expect(gmailQuery(['Edfinancial'], '2026-09-18')).toBe('from:Edfinancial after:2026/09/18');
    expect(gmailQuery(['edfinancial.com', 'Nelnet Servicing'], '2026-09-18')).toBe(
      'from:(edfinancial.com OR "Nelnet Servicing") after:2026/09/18',
    );
  });
});

describe('statementSources', () => {
  it('lists a collection with a sender, its confirmed rows by ID and the search to run', () => {
    const sources = statementSources({
      collections: [LOANS],
      kinds: [kind({})],
      records: [
        record({}),
        record({ id: 'draft', draft: true }),
        record({ id: 'no-id', data: { name: 'Unknown', balance: 10 } }),
      ],
      today: '2026-09-29',
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: 'loans',
      idKey: 'loan_id',
      senders: ['Edfinancial', 'edfinancial.com'],
      // The row was saved on 25 Sep, and the search reaches a week back from today at least.
      query: 'from:(Edfinancial OR edfinancial.com) after:2026/09/22',
    });
    expect(sources[0].rows).toEqual([
      {
        recordId: 'r1',
        idValue: '*****8042P25G01426001',
        label: 'Grad PLUS 2024–25',
        asOf: '2026-09-25',
        tracked: { balance: 80080.21, principal: 68610, interest: 11470.21 },
        limit: 1593.94,
      },
    ]);
  });

  it('starts the search at the oldest figures, but no more than 62 days back', () => {
    const [source] = statementSources({
      collections: [LOANS],
      kinds: [kind({})],
      records: [record({ asOf: '2026-09-02' }), record({ id: 'r2', asOf: '2025-01-01' })],
      today: '2026-09-29',
    });
    expect(source.query).toContain('after:2026/07/29');
    const [recent] = statementSources({
      collections: [LOANS],
      kinds: [kind({})],
      records: [record({ asOf: '2026-09-02' })],
      today: '2026-09-29',
    });
    expect(recent.query).toContain('after:2026/09/02');
  });

  it('leaves out a collection with no sender, no ID field or one record', () => {
    const noId = { ...LOANS, fields: FIELDS.map((f) => ({ ...f, id: undefined })) };
    expect(
      statementSources({
        collections: [LOANS],
        kinds: [kind({ senders: [] })],
        records: [],
        today: '2026-09-29',
      }),
    ).toEqual([]);
    expect(
      statementSources({
        collections: [noId],
        kinds: [kind({})],
        records: [],
        today: '2026-09-29',
      }),
    ).toEqual([]);
    expect(
      statementSources({
        collections: [{ ...LOANS, shape: 'one' }],
        kinds: [kind({})],
        records: [],
        today: '2026-09-29',
      }),
    ).toEqual([]);
  });
});

describe('statementLines', () => {
  it('says nothing when there is nothing to search', () => {
    expect(statementLines([])).toEqual([]);
  });

  it('names the search, the kind and each row with how far it may move', () => {
    const lines = statementLines(
      statementSources({
        collections: [LOANS],
        kinds: [kind({})],
        records: [record({})],
        today: '2026-09-29',
      }),
    ).join('\n');
    expect(lines).toContain(
      'Search Gmail for: from:(Edfinancial OR edfinancial.com) after:2026/09/22',
    );
    expect(lines).toContain('"Edfinancial statement" (goals.document_kinds id k1)');
    expect(lines).toContain(
      '*****8042P25G01426001, Grad PLUS 2024–25 (goals.records id r1), figures as of 2026-09-25: balance 80080.21, principal 68610, interest 11470.21; straight in when each money value moves by no more than $1,593.94',
    );
    expect(lines).toContain('"Reading new');
  });
});
