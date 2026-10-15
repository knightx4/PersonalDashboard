import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import { tableWorkspace } from '@/lib/sources/catalogue';
import type { WaitingOnYou } from '@/lib/jobs/today/waiting';

/**
 * Mail waiting on you, which left Jobs' Today for the Jobs Inbox (plan
 * #1937.9): one row a request, in the jobs workspace, answered where it lives.
 */

const rows: WaitingOnYou[] = [];
const setWaitingDismissal = vi.fn(async () => ({ error: null as string | null }));

vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: { jobs: async () => ({}) } }));
vi.mock('@/lib/jobs/today/waiting', () => ({
  loadWaitingOnYou: async () => rows,
  setWaitingDismissal,
}));

const { jobWaitingSource, waitingItems } = await import('./job-waiting');

const ctx = {
  userId: 'u',
  timezone: 'UTC',
  from: '2026-09-29',
  to: '2026-10-12',
  now: new Date('2026-10-01T12:00:00Z'),
};

function request(eventId: string, extra: Partial<WaitingOnYou> = {}): WaitingOnYou {
  return {
    eventId,
    applicationId: 'a',
    roleId: 'r',
    companyName: 'Monzo',
    roleTitle: 'Senior Designer',
    kind: 'email',
    summary: 'Asked for two references',
    occurredAt: '2026-09-30T09:00:00Z',
    ...extra,
  };
}

describe('jobWaitingSource', () => {
  beforeEach(() => {
    rows.length = 0;
    setWaitingDismissal.mockClear();
  });

  it('lists a request as the reply you owe, with what it asked under it, undated, opening the role', () => {
    const [item] = waitingItems([request('e1')]);
    expect(item.title).toBe('Reply to Monzo');
    expect(item.detail).toBe('Asked for two references · Senior Designer');
    expect(item.day).toBeNull();
    expect(item.onYouSince).toBe('2026-09-30T09:00:00Z');
    expect(item.link?.href).toBe('/jobs/roles/r');
    expect(item.completable).toBe(true);
  });

  it('says something when the mail gave no summary', () => {
    const [item] = waitingItems([request('e1', { summary: '  ' })]);
    expect(item.detail).toBe('They asked you something by mail · Senior Designer');
  });

  it('names the application event, which is in the jobs workspace', () => {
    const [item] = waitingItems([request('e1')]);
    const ref = parseRef(item.ref);
    expect(ref?.id).toBe('e1');
    expect(tableWorkspace(ref!.table)).toBe('jobs');
  });

  it('is always on, so a switch on Todo cannot hide what is on you', () => {
    expect(jobWaitingSource.alwaysOn).toBe(true);
  });

  it('marks it dealt with for good on Done and on Not this one', async () => {
    await jobWaitingSource.complete!(ctx, 'job_waiting:e1');
    await jobWaitingSource.dismiss!(ctx, 'job_waiting:e2');
    expect(setWaitingDismissal.mock.calls.map((call) => (call as unknown[]).slice(1))).toEqual([
      ['u', 'e1', null],
      ['u', 'e2', null],
    ]);
  });

  it('puts it off a week on Later', async () => {
    await jobWaitingSource.defer!(ctx, 'job_waiting:e1');
    const [, , eventId, until] = setWaitingDismissal.mock.calls[0] as unknown[];
    expect(eventId).toBe('e1');
    expect(until).toBe('2026-10-08T12:00:00.000Z');
  });

  it('reads the requests through the shared reader', async () => {
    rows.push(request('e1'), request('e2'));
    expect((await jobWaitingSource.fetch(ctx)).map((item) => item.key)).toEqual([
      'job_waiting:e1',
      'job_waiting:e2',
    ]);
  });
});
