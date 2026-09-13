import { describe, expect, it } from 'vitest';
import { jobsSelectionTargets, reviewRowKey } from './bulk';
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
