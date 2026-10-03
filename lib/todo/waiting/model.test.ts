import { describe, expect, it } from 'vitest';
import { applicationMoves, type ApplicationMoveInput } from '@/lib/jobs/applications/moves';
import { applicationItems } from '@/lib/todo/agenda/sources/applications';
import type { ReturnsTrackerRow } from '@/lib/returns/types';
import {
  SOMEONE_ELSE,
  applicationWaits,
  groupWaiting,
  returnWaits,
  sinceLabel,
  type WaitingEntry,
} from '@/lib/todo/waiting/model';

/**
 * Todo's Waiting view and the agenda's applications on you (plan #1475): an
 * application sent to a company is in Waiting under that company, and when
 * the move comes back to you it leaves Waiting for the main list.
 */

const sent: ApplicationMoveInput = {
  id: 'app-1',
  status: 'submitted',
  submittedAt: '2026-09-01T10:00:00Z',
  createdAt: '2026-08-30T10:00:00Z',
  roleId: 'role-1',
  roleTitle: 'Product Manager',
  companyName: 'EliseAI',
};

describe('an application through Waiting and the agenda', () => {
  it('sits in Waiting under its company once sent', () => {
    const rows = applicationMoves(
      [sent],
      [{ applicationId: 'app-1', kind: 'submitted', occurredAt: '2026-09-01T10:00:00Z' }],
    );
    const groups = groupWaiting(applicationWaits(rows));

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('EliseAI');
    expect(groups[0].entries.map((entry) => entry.title)).toEqual(['Product Manager']);
    expect(groups[0].entries[0].ref).toBe('job_search.applications:app-1');
    expect(applicationItems(rows)).toEqual([]);
  });

  it('leaves Waiting for the agenda when they write back', () => {
    const rows = applicationMoves(
      [{ ...sent, status: 'acknowledged' }],
      [
        { applicationId: 'app-1', kind: 'submitted', occurredAt: '2026-09-01T10:00:00Z' },
        { applicationId: 'app-1', kind: 'recruiter_reply', occurredAt: '2026-09-10T09:00:00Z' },
        // A note you wrote afterwards does not hand the move back.
        { applicationId: 'app-1', kind: 'note', occurredAt: '2026-09-11T09:00:00Z' },
      ],
    );

    expect(groupWaiting(applicationWaits(rows))).toEqual([]);

    const items = applicationItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'applications',
      title: 'Reply to EliseAI',
      day: null,
      onYouSince: '2026-09-10T09:00:00Z',
      link: { href: '/jobs/roles/role-1', label: 'Product Manager' },
      completable: false,
    });
    // The turn is in the key, so putting this one off leaves the next to show.
    expect(items[0].key).toBe('applications:app-1:2026-09-10T09:00:00Z');
  });

  it('goes back to Waiting once you have replied', () => {
    const rows = applicationMoves(
      [{ ...sent, status: 'in_process' }],
      [
        { applicationId: 'app-1', kind: 'recruiter_reply', occurredAt: '2026-09-10T09:00:00Z' },
        { applicationId: 'app-1', kind: 'follow_up_sent', occurredAt: '2026-09-12T09:00:00Z' },
      ],
    );
    expect(applicationItems(rows)).toEqual([]);
    expect(groupWaiting(applicationWaits(rows))[0].name).toBe('EliseAI');
  });

  it('puts an offer on you even with no event', () => {
    const rows = applicationMoves([{ ...sent, status: 'offer' }], []);
    expect(applicationItems(rows)[0].title).toBe('Answer the EliseAI offer');
  });
});

describe('groupWaiting', () => {
  const entry = (key: string, waitingOn: WaitingEntry['waitingOn'], since: string | null): WaitingEntry => ({
    key,
    ref: `x.y:${key}`,
    module: 'jobs',
    title: key,
    detail: null,
    waitingOn,
    why: '',
    since,
    link: null,
  });

  it('groups by who, ignoring case, longest wait first, someone else last', () => {
    const groups = groupWaiting([
      entry('a', 'UPS', '2026-09-20'),
      entry('b', undefined, '2026-01-01'),
      entry('c', 'Acme', '2026-09-05'),
      entry('d', 'ups', '2026-09-01'),
    ]);
    expect(groups.map((group) => group.name)).toEqual(['UPS', 'Acme', SOMEONE_ELSE]);
    expect(groups[0].entries.map((item) => item.key)).toEqual(['d', 'a']);
  });

  it('groups a ref by its ref and names it by its title', () => {
    const groups = groupWaiting([entry('a', { ref: 'core.people:1', title: 'Sam' }, null)]);
    expect(groups[0]).toMatchObject({ key: 'ref:core.people:1', name: 'Sam' });
  });
});

describe('returnWaits', () => {
  const row = (overrides: Partial<ReturnsTrackerRow>): ReturnsTrackerRow => ({
    inventoryItemId: 'i1',
    name: 'Desk lamp',
    variant: null,
    costCents: 1000,
    orderId: 'o1',
    orderDate: '2026-09-20',
    externalOrderNumber: '123',
    orderStatus: 'shipped',
    merchantId: 'm1',
    merchantName: 'Ikea',
    returnDeadline: null,
    daysLeft: null,
    returnPlanned: false,
    returnWindowDays: null,
    delivered: false,
    carrier: 'UPS',
    status: 'owned',
    returnId: null,
    refundedAt: null,
    ...overrides,
  });

  it('makes one entry per order, under the carrier once shipped and the shop before', () => {
    const entries = returnWaits([
      row({}),
      row({ inventoryItemId: 'i2', name: 'Bulb' }),
      row({ inventoryItemId: 'i3', orderId: 'o2', orderStatus: 'ordered', name: 'Rug' }),
      row({ inventoryItemId: 'i4', orderId: 'o3', delivered: true, daysLeft: 5 }),
    ]);
    expect(entries.map((item) => [item.title, item.waitingOn])).toEqual([
      ['Desk lamp and 1 more', 'UPS'],
      ['Rug', 'Ikea'],
    ]);
  });
});

describe('sinceLabel', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  it('shows a bare day as that day', () => {
    expect(sinceLabel('2026-05-22', 'America/Los_Angeles', now)).toBe('Since 22 May');
  });
  it('adds the year when it is not this one', () => {
    expect(sinceLabel('2025-12-30T10:00:00Z', 'UTC', now)).toBe('Since 30 Dec 2025');
  });
  it('is nothing without a date', () => {
    expect(sinceLabel(null, 'UTC', now)).toBeNull();
  });
});
