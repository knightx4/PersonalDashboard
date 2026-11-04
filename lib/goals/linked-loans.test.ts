import { describe, expect, it } from 'vitest';
import type { CollectionField } from './collections';
import type { CollectionInformation, CollectionRecord } from './collections-store';
import { applyLinkedLoans, balanceField, matchLoan, type LinkedLoan } from './linked-loans';

const fields: CollectionField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'account', label: 'Account number', type: 'text', id: true },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
];

const record = (data: CollectionRecord['data']): CollectionRecord => ({
  id: 'r1',
  collectionId: 'c1',
  data,
  version: 1,
  position: 0,
  source: 'typed',
  sourceRef: null,
  draft: false,
  asOf: null,
  updatedAt: '2026-10-01T00:00:00Z',
});

const info = (records: CollectionRecord[], f = fields): Record<string, CollectionInformation> => ({
  c1: {
    collection: {
      id: 'c1',
      version: 1,
      goalIds: [],
      name: 'Loans',
      fields: f,
    } as unknown as CollectionInformation['collection'],
    records,
  },
});

const loan = (extra: Partial<LinkedLoan> = {}): LinkedLoan => ({
  accountId: 'acc1',
  mask: '4821',
  balanceCents: 1_234_567,
  readOn: '2026-10-27',
  ...extra,
});

describe('linked loans', () => {
  it('shows the linked account balance for a record whose number ends with its mask', () => {
    const out = applyLinkedLoans(
      info([record({ name: 'Grad', account: '1100-4821', balance: 9000 })]),
      [loan()],
    );
    const r = out.c1.records[0];
    expect(r.data.balance).toBe(12345.67);
    expect(r.linkedBalance).toEqual({ accountId: 'acc1', readOn: '2026-10-27' });
  });

  it('matches on a row-in-the-app field', () => {
    const f: CollectionField[] = [...fields, { key: 'acct', label: 'Account', type: 'ref' }];
    const data = { name: 'Grad', acct: 'finances.accounts:acc1', balance: 9000 };
    expect(matchLoan(f, data, [loan({ mask: null })])?.accountId).toBe('acc1');
  });

  it('keeps the record unchanged when no linked loan matches', () => {
    const before = info([record({ name: 'Grad', account: '9999', balance: 9000 })]);
    expect(applyLinkedLoans(before, [loan()])).toEqual(before);
    expect(applyLinkedLoans(before, [])).toBe(before);
  });

  it('does not guess between two loans with the same mask', () => {
    const data = { account: '4821' };
    expect(matchLoan(fields, data, [loan(), loan({ accountId: 'acc2' })])).toBeNull();
  });

  it('leaves a collection with no balance field alone', () => {
    const f = fields.filter((x) => x.key !== 'balance');
    expect(balanceField(f)).toBeNull();
    const before = info([record({ account: '4821' })], f);
    expect(applyLinkedLoans(before, [loan()])).toEqual(before);
  });
});
