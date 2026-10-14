import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));

import { waitingItems } from './job-waiting';

/**
 * Mail waiting on a reply as Jobs Inbox rows (plan #1937.9): the request
 * names the row, the role sits under it, and each covers its application so
 * "Reply to Wise" is not listed beside it.
 */

const row = {
  eventId: 'e1',
  applicationId: 'a1',
  roleId: 'r1',
  companyName: 'Wise',
  roleTitle: 'Senior Product Designer',
  kind: 'recruiter_reply',
  summary: 'Asked for times next week',
  occurredAt: '2026-10-07T09:00:00.000Z',
};

describe('waitingItems', () => {
  it('titles the row with the request and puts the role under it', () => {
    const [item] = waitingItems([row], 'Europe/London');
    expect(item).toMatchObject({
      key: 'job_waiting:e1',
      source: 'job_waiting',
      ref: 'job_search.application_events:e1',
      title: 'Asked for times next week',
      detail: 'Wise · Senior Product Designer · wrote Wed 7 Oct',
      day: null,
      onYouSince: '2026-10-07T09:00:00.000Z',
      completable: true,
      workspace: 'jobs',
      covers: ['job_search.applications:a1'],
    });
    expect(item.link).toEqual({ href: '/jobs/roles/r1', label: 'Wise · Senior Product Designer' });
  });

  it('falls back to the company when the email has no summary', () => {
    const [item] = waitingItems([{ ...row, summary: '  ' }], 'Europe/London');
    expect(item.title).toBe('Reply to Wise');
    expect(item.detail).toBe('wrote Wed 7 Oct');
  });
});
