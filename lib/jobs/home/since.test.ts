import { describe, expect, it } from 'vitest';
import { FIRST_VISIT_DAYS, nextHomeVisit, sinceOf, stoppedInboxes } from './since';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const MINUTE = 60 * 1000;
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString();

describe('nextHomeVisit', () => {
  it('has no previous visit on the first one', () => {
    expect(nextHomeVisit(null, NOW)).toEqual({ lastVisitAt: NOW.toISOString(), previousVisitAt: null });
  });

  it('starts a new sitting from the last visit after half an hour or more', () => {
    const record = { lastVisitAt: at(45), previousVisitAt: at(600) };
    expect(nextHomeVisit(record, NOW)).toEqual({ lastVisitAt: NOW.toISOString(), previousVisitAt: at(45) });
  });

  it('keeps the sitting\'s previous visit on a reload inside half an hour', () => {
    const record = { lastVisitAt: at(5), previousVisitAt: at(600) };
    expect(nextHomeVisit(record, NOW).previousVisitAt).toBe(at(600));
  });
});

describe('sinceOf', () => {
  it('starts at the previous visit', () => {
    expect(sinceOf({ lastVisitAt: NOW.toISOString(), previousVisitAt: at(90) }, NOW)).toEqual({
      since: at(90),
      firstVisit: false,
    });
  });

  it('looks back a week on a first visit', () => {
    expect(sinceOf({ lastVisitAt: NOW.toISOString(), previousVisitAt: null }, NOW)).toEqual({
      since: at(FIRST_VISIT_DAYS * 24 * 60),
      firstVisit: true,
    });
  });
});

describe('stoppedInboxes', () => {
  it('names the mailboxes needing reconnection or in error, not a disconnected one', () => {
    const accounts = [
      { id: 'a', emailAddress: 'a@example.com', status: 'active' },
      { id: 'b', emailAddress: 'b@example.com', status: 'needs_reauth' },
      { id: 'c', emailAddress: 'c@example.com', status: 'error' },
      { id: 'd', emailAddress: 'd@example.com', status: 'disconnected' },
    ];
    expect(stoppedInboxes(accounts).map((account) => account.id)).toEqual(['b', 'c']);
  });
});
