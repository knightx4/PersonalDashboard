import { describe, expect, it } from 'vitest';
import {
  jobsSelectionTargets,
  reviewRowKey,
  reviewRowLabel,
  reviewRowsInView,
  reviewViewIn,
  reviewViewsShown,
} from './bulk';
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

describe('the Inbox views', () => {
  const counts = { all: 7, messages: 4, applications: 2, events: 1 };
  const kinds = [{ kind: 'message' }, { kind: 'event' }, { kind: 'application' }, { kind: 'message' }] as const;

  it('offers All and each kind with something waiting', () => {
    expect(reviewViewsShown(counts).map((view) => [view.id, view.count])).toEqual([
      ['all', 7],
      ['messages', 4],
      ['applications', 2],
      ['events', 1],
    ]);
    expect(reviewViewsShown({ ...counts, events: 0 }).map((view) => view.id)).toEqual([
      'all',
      'messages',
      'applications',
    ]);
  });

  it('offers nothing when every item is one kind', () => {
    expect(reviewViewsShown({ all: 3, messages: 3, applications: 0, events: 0 })).toEqual([]);
  });

  it('falls back to All for a view that is not offered', () => {
    expect(reviewViewIn('events', { ...counts, events: 0 })).toBe('all');
    expect(reviewViewIn('events', counts)).toBe('events');
    expect(reviewViewIn('messages', { all: 3, messages: 3, applications: 0, events: 0 })).toBe('all');
  });

  it('keeps the rows of the kind a view names, in order', () => {
    expect(reviewRowsInView(kinds, 'messages')).toEqual([kinds[0], kinds[3]]);
    expect(reviewRowsInView(kinds, 'all')).toEqual(kinds);
  });
});

describe('reviewRowLabel', () => {
  it('names a message by its subject, or says it has none', () => {
    expect(reviewRowLabel({ kind: 'message', subject: ' Next steps ' } as ReviewRow)).toBe('Next steps');
    expect(reviewRowLabel({ kind: 'message', subject: null } as ReviewRow)).toBe('message without a subject');
  });
});
