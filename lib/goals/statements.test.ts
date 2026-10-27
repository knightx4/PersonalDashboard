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

// A loans collection of the shape plan #1023 describes.
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

const GRAD_LOAN = {
  name: 'Graduate loan 2024–25',
  servicer: 'Brightline',
  balance: 42000,
  rate: 8.4,
  minimum: 520,
  loan_id: '*****5170P25G01000001',
  status: 'Deferred',
  principal: 36000,
  interest: 6000,
  next_due: '2026-12-18',
};

function record(over: Partial<CollectionRecord>): CollectionRecord {
  return {
    id: 'r1',
    collectionId: 'c1',
    data: GRAD_LOAN,
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
    name: 'Brightline statement',
    recognise: '',
    fieldNotes: {},
    skipped: [],
    senders: ['Brightline', 'brightline.example'],
    lastReadAt: null,
    ...over,
  };
}

const LOANS = { id: 'c1', name: 'loans', shape: 'list' as const, fields: FIELDS };

describe('ordinaryLimit', () => {
  it("is a month's payment plus a month's interest on the balance", () => {
    // 520 + 42,000 × 8.4% / 12 = 520 + 294
    expect(ordinaryLimit(FIELDS, GRAD_LOAN)).toBe(814);
  });

  it('is only the interest when no payment is set', () => {
    const unsub = {
      ...GRAD_LOAN,
      minimum: null,
      balance: 12000,
      principal: 11000,
      interest: 1000,
      rate: 6,
    };
    expect(ordinaryLimit(FIELDS, unsub)).toBe(60);
  });

  it('is null when the row has no tracked money value', () => {
    expect(ordinaryLimit(FIELDS, { loan_id: 'x' })).toBeNull();
  });
});

describe('checkChange', () => {
  it('lets a month of interest and a new due date through', () => {
    const after = {
      balance: 42294,
      interest: 6294,
      next_due: '2027-01-18',
      as_of: '2026-10-02',
    };
    expect(checkChange(FIELDS, GRAD_LOAN, after)).toEqual({ ordinary: true });
  });

  it('lets a payment through', () => {
    expect(checkChange(FIELDS, GRAD_LOAN, { balance: 41480 })).toEqual({ ordinary: true });
  });

  it('holds a balance that moved by more than a payment and interest', () => {
    const check = checkChange(FIELDS, GRAD_LOAN, { balance: 32000 });
    expect(check.ordinary).toBe(false);
    if (!check.ordinary) expect(check.reason).toContain('Balance moved by $10,000.00');
  });

  it('holds a change of status or payment amount', () => {
    expect(checkChange(FIELDS, GRAD_LOAN, { status: 'Repayment' }).ordinary).toBe(false);
    expect(checkChange(FIELDS, GRAD_LOAN, { minimum: 560 }).ordinary).toBe(false);
  });

  it('ignores values that did not change or that the statement left out', () => {
    expect(checkChange(FIELDS, GRAD_LOAN, { status: 'Deferred', rate: null })).toEqual({
      ordinary: true,
    });
  });
});

describe('gmailQuery', () => {
  it('searches one sender, or several joined with OR, quoting names with a space', () => {
    expect(gmailQuery(['Brightline'], '2026-09-18')).toBe('from:Brightline after:2026/09/18');
    expect(gmailQuery(['brightline.example', 'Northstar Servicing'], '2026-09-18')).toBe(
      'from:(brightline.example OR "Northstar Servicing") after:2026/09/18',
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
      senders: ['Brightline', 'brightline.example'],
      // The row was saved on 25 Sep, and the search reaches a week back from today at least.
      query: 'from:(Brightline OR brightline.example) after:2026/09/22',
    });
    expect(sources[0].rows).toEqual([
      {
        recordId: 'r1',
        idValue: '*****5170P25G01000001',
        label: 'Graduate loan 2024–25',
        asOf: '2026-09-25',
        tracked: { balance: 42000, principal: 36000, interest: 6000 },
        limit: 814,
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
      'Search Gmail for: from:(Brightline OR brightline.example) after:2026/09/22',
    );
    expect(lines).toContain('"Brightline statement" (goals.document_kinds id k1)');
    expect(lines).toContain(
      '*****5170P25G01000001, Graduate loan 2024–25 (goals.records id r1), figures as of 2026-09-25: balance 42000, principal 36000, interest 6000; straight in when each money value moves by no more than $814.00',
    );
    expect(lines).toContain('"Reading new');
  });
});
