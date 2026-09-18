import { describe, expect, it } from 'vitest';
import {
  batchMessage,
  batchResult,
  countNoun,
  undoneMessage,
  type BatchTally,
} from '@/lib/use-batch-write';

const tally = (over: Partial<BatchTally> = {}): BatchTally => ({
  verb: 'Confirmed',
  asked: 4,
  changed: 4,
  one: 'order',
  ...over,
});

describe('countNoun', () => {
  it('counts in the singular for one row', () => {
    expect(countNoun(1, 'order')).toBe('1 order');
  });

  it('adds an s for anything else, none included', () => {
    expect(countNoun(4, 'order')).toBe('4 orders');
    expect(countNoun(0, 'order')).toBe('0 orders');
  });

  it('takes a plural that is not the singular plus an s', () => {
    expect(countNoun(2, 'entry', 'entries')).toBe('2 entries');
  });
});

describe('batchMessage', () => {
  it('says what it did when it did all of it', () => {
    expect(batchMessage(tally())).toBe('Confirmed 4 orders.');
  });

  it('says both numbers when some rows did not move', () => {
    expect(batchMessage(tally({ changed: 2 }))).toBe('Confirmed 2 of 4 orders.');
  });

  it('says why when nothing moved', () => {
    expect(batchMessage(tally({ changed: 0, error: 'Two of these are already confirmed.' }))).toBe(
      'Two of these are already confirmed.',
    );
  });

  it('still says something when nothing moved and nothing was said', () => {
    expect(batchMessage(tally({ changed: 0 }))).toBe('Nothing changed.');
    expect(batchMessage(tally({ changed: 0, error: '  ' }))).toBe('Nothing changed.');
  });
});

describe('undoneMessage', () => {
  it('counts what was put back, not what was asked for', () => {
    expect(undoneMessage(tally({ changed: 2 }))).toBe('2 orders put back.');
    expect(undoneMessage(tally({ changed: 1 }))).toBe('1 order put back.');
  });
});

describe('batchResult', () => {
  const ids = ['a', 'b', 'c'];

  it('takes the ids an action says it changed', () => {
    expect(batchResult({ changed: ['a', 'c'] }, ids)).toEqual({ changed: ['a', 'c'], error: null });
  });

  it('reads every asked-for id as changed when the action named none', () => {
    expect(batchResult({ error: null }, ids)).toEqual({ changed: ids, error: null });
    expect(batchResult(undefined, ids)).toEqual({ changed: ids, error: null });
  });

  it('changes nothing when the action refused and named no rows', () => {
    expect(batchResult({ error: 'Not yours.' }, ids)).toEqual({ changed: [], error: 'Not yours.' });
  });

  // A partial run: some rows moved and the action said why the rest did not.
  it('keeps both halves when an action refused part of a batch', () => {
    expect(batchResult({ changed: ['a'], error: 'Two were already confirmed.' }, ids)).toEqual({
      changed: ['a'],
      error: 'Two were already confirmed.',
    });
  });

  it('ignores anything in the list that is not an id', () => {
    expect(batchResult({ changed: ['a', 7, null] }, ids)).toEqual({ changed: ['a'], error: null });
  });
});
