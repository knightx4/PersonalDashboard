import { describe, expect, it } from 'vitest';
import { askedFor, connectedApps, readsOf, type ConnectorCallInput } from './apps';

/** The Connected apps section's grouping (plan #1258). */

function call(overrides: Partial<ConnectorCallInput>): ConnectorCallInput {
  return {
    id: 'c1',
    client_id: 'claude',
    client_name: null,
    tool: 'search',
    input: {},
    reads: [],
    outcome: 'ok',
    error: null,
    created_at: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

describe('connectedApps', () => {
  it('names each app from its grant and puts its calls under it, newest first', () => {
    const apps = connectedApps(
      [{ client: { id: 'claude', name: 'Claude' }, granted_at: '2026-09-29T08:00:00.000Z' }],
      [
        call({ id: 'old', created_at: '2026-09-30T09:00:00.000Z' }),
        call({ id: 'new', created_at: '2026-09-30T11:00:00.000Z' }),
      ],
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      clientId: 'claude',
      name: 'Claude',
      grantedAt: '2026-09-29T08:00:00.000Z',
    });
    expect(apps[0].calls.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('lists a granted app with no calls', () => {
    const apps = connectedApps(
      [{ client: { id: 'claude', name: 'Claude' }, granted_at: '2026-09-29T08:00:00.000Z' }],
      [],
    );
    expect(apps).toEqual([
      { clientId: 'claude', name: 'Claude', grantedAt: '2026-09-29T08:00:00.000Z', calls: [] },
    ]);
  });

  it('keeps the calls of a removed app, after the granted ones and with no grant date', () => {
    const apps = connectedApps(
      [{ client: { id: 'claude', name: 'Claude' }, granted_at: '2026-09-29T08:00:00.000Z' }],
      [call({ id: 'gone', client_id: 'old-client', created_at: '2026-09-30T13:00:00.000Z' })],
    );
    expect(apps.map((a) => [a.clientId, a.grantedAt])).toEqual([
      ['claude', '2026-09-29T08:00:00.000Z'],
      ['old-client', null],
    ]);
    expect(apps[1].name).toBe('A removed app');
    expect(apps[1].calls.map((c) => c.id)).toEqual(['gone']);
  });

  it('carries the outcome, the error and the reads of each call', () => {
    const apps = connectedApps(
      [],
      [
        call({
          id: 'ok',
          tool: 'spend_by_merchant',
          input: { merchant: 'eBay', from: '2026-08-01', to: '2026-08-31' },
          reads: [{ table: 'orders', ref: 'o1', title: 'eBay order', href: '/shopping/orders/o1' }],
        }),
        call({
          id: 'limited',
          outcome: 'limited',
          error: 'Too many calls',
          created_at: '2026-09-30T11:00:00.000Z',
        }),
      ],
    );
    const [ok, limited] = apps[0].calls;
    expect(ok).toMatchObject({
      label: 'Read spending by merchant',
      asked: 'eBay, 2026-08-01 to 2026-08-31',
      outcome: 'ok',
      reads: [{ table: 'orders', ref: 'o1', title: 'eBay order', href: '/shopping/orders/o1' }],
    });
    expect(limited).toMatchObject({ outcome: 'limited', error: 'Too many calls', reads: [] });
  });
});

describe('askedFor', () => {
  it('quotes a search and leaves out what it cannot say plainly', () => {
    expect(askedFor({ query: 'tax return', kinds: ['note'] })).toBe('“tax return”');
    expect(askedFor({ table: 'orders', ref: 'x' })).toBeNull();
    expect(askedFor('not an object')).toBeNull();
  });
});

describe('readsOf', () => {
  it('drops malformed rows and any address that leaves the app', () => {
    expect(
      readsOf([
        { table: 'orders', ref: 'o1', title: '', href: '/shopping/orders/o1' },
        { table: 'notes', ref: 'n1', title: 'Note', href: 'https://evil.example/' },
        { table: 'notes', ref: 'n2', title: 'Note 2', href: '//evil.example/' },
        { ref: 'missing table' },
        null,
      ]),
    ).toEqual([
      { table: 'orders', ref: 'o1', title: 'o1', href: '/shopping/orders/o1' },
      { table: 'notes', ref: 'n1', title: 'Note', href: '' },
      { table: 'notes', ref: 'n2', title: 'Note 2', href: '' },
    ]);
    expect(readsOf('nope')).toEqual([]);
  });
});
