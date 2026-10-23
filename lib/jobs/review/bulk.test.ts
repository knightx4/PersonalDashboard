import { describe, expect, it } from 'vitest';
import { inboxReviewHead, jobsSelectionTargets, reviewRowKey, reviewRowLabel } from './bulk';
import type { ReviewRow } from './load';

const row = (kind: ReviewRow['kind'], id: string): ReviewRow => ({ kind, id }) as ReviewRow;

const rows = [
  row('message', 'm1'),
  row('application', 'a1'),
  row('event', 'e1'),
  row('message', 'm2'),
];
const selecting =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);

describe('reviewRowKey', () => {
  // An application and the event it produced can share an id; the kind is what
  // keeps their rows apart in one selection.
  it('keeps two kinds with the same id apart', () => {
    expect(reviewRowKey({ kind: 'message', id: 'x' })).not.toBe(
      reviewRowKey({ kind: 'event', id: 'x' }),
    );
  });
});

describe('jobsSelectionTargets', () => {
  it('splits a mixed selection into what each verb would touch', () => {
    expect(jobsSelectionTargets(rows, selecting('message-m1', 'event-e1', 'message-m2'))).toEqual({
      messageIds: ['m1', 'm2'],
      eventIds: ['e1'],
    });
  });

  it('offers neither verb for an inferred application on its own', () => {
    expect(jobsSelectionTargets(rows, selecting('application-a1'))).toEqual({
      messageIds: [],
      eventIds: [],
    });
  });

  it('is empty for an empty selection', () => {
    expect(jobsSelectionTargets(rows, () => false)).toEqual({ messageIds: [], eventIds: [] });
  });
});

describe('inboxReviewHead', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  it('lists the first five and leaves the rest for Review', () => {
    expect(inboxReviewHead(many, 7)).toEqual({ shown: ['a', 'b', 'c', 'd', 'e'], rest: 2 });
  });

  it('leaves nothing over when five or fewer wait', () => {
    expect(inboxReviewHead(['a', 'b'], 2)).toEqual({ shown: ['a', 'b'], rest: 0 });
  });

  it('counts the rest from the queue total, not the rows handed over', () => {
    expect(inboxReviewHead(many.slice(0, 5), 9).rest).toBe(4);
  });
});

describe('reviewRowLabel', () => {
  it('names a message by its subject, or says it has none', () => {
    expect(reviewRowLabel({ kind: 'message', subject: ' Next steps ' } as ReviewRow)).toBe('Next steps');
    expect(reviewRowLabel({ kind: 'message', subject: null } as ReviewRow)).toBe('message without a subject');
  });
});
