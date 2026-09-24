import { describe, expect, it } from 'vitest';
import {
  carriedBy,
  carrierFor,
  checkLine,
  checkWord,
  conclusionFrom,
  shouldRecheck,
  type CommitCheck,
  type CommitNode,
} from './checks';

/**
 * main:   c0 <- m1 <- m2
 * m1 merged a branch of one commit, a1; m2 merged a branch of two, b1 and b2.
 * The listing comes back newest first, which is what `carriedBy` assumes.
 */
const HISTORY: CommitNode[] = [
  { sha: 'm2', parents: ['m1', 'b2'] },
  { sha: 'b2', parents: ['b1'] },
  { sha: 'b1', parents: ['m1'] },
  { sha: 'm1', parents: ['c0', 'a1'] },
  { sha: 'a1', parents: ['c0'] },
  { sha: 'c0', parents: [] },
];

describe('carriedBy', () => {
  it('credits each branch commit to the merge that put it on main', () => {
    const carrier = carriedBy(HISTORY);

    expect(carrier.get('a1')).toBe('m1');
    expect(carrier.get('b1')).toBe('m2');
    expect(carrier.get('b2')).toBe('m2');
  });

  it('makes a commit on main its own carrier', () => {
    const carrier = carriedBy(HISTORY);

    expect(carrier.get('m2')).toBe('m2');
    expect(carrier.get('c0')).toBe('c0');
  });

  it('credits a branch merged twice to the merge that took it first', () => {
    // b1 is reachable from both merges; the older one is what shipped it.
    const twice: CommitNode[] = [
      { sha: 'm2', parents: ['m1', 'b1'] },
      { sha: 'm1', parents: ['c0', 'b1'] },
      { sha: 'b1', parents: ['c0'] },
      { sha: 'c0', parents: [] },
    ];

    expect(carriedBy(twice).get('b1')).toBe('m1');
  });

  it('says nothing about a commit the listing does not reach', () => {
    expect(carriedBy(HISTORY).get('z9')).toBeUndefined();
  });
});

describe('carrierFor', () => {
  const carrier = carriedBy([
    { sha: 'abc1234def', parents: ['0000000'] },
    { sha: '0000000', parents: [] },
  ]);

  it('takes the short sha a step actually records', () => {
    expect(carrierFor(carrier, 'abc1234')).toBe('abc1234def');
  });

  it('refuses a prefix that matches two different merges', () => {
    const colliding = carriedBy([
      { sha: 'ff11', parents: ['ff12'] },
      { sha: 'aa00', parents: ['ff11'] },
      { sha: 'ff12', parents: [] },
    ]);

    // 'ff' matches ff11 and ff12, which were carried by different merges.
    expect(carrierFor(colliding, 'ff')).toBeNull();
  });

  it('is null for a commit nothing on main carries', () => {
    expect(carrierFor(carrier, '9999999')).toBeNull();
  });
});

describe('conclusionFrom', () => {
  it('is none when nothing ran', () => {
    expect(conclusionFrom([])).toBe('none');
  });

  it('is passed when every run completed and none failed', () => {
    expect(
      conclusionFrom([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'skipped' },
      ]),
    ).toBe('passed');
  });

  it('is failed even while another run is still going', () => {
    expect(
      conclusionFrom([
        { status: 'completed', conclusion: 'failure' },
        { status: 'in_progress', conclusion: null },
      ]),
    ).toBe('failed');
  });

  it('counts a cancelled run as a failure rather than a pass', () => {
    expect(conclusionFrom([{ status: 'completed', conclusion: 'cancelled' }])).toBe('failed');
  });

  it('is running while anything has not completed', () => {
    expect(
      conclusionFrom([
        { status: 'completed', conclusion: 'success' },
        { status: 'queued', conclusion: null },
      ]),
    ).toBe('running');
  });
});

describe('shouldRecheck', () => {
  const now = Date.parse('2026-09-17T12:00:00Z');
  const check = (over: Partial<CommitCheck>): CommitCheck => ({
    mergeSha: 'm2',
    conclusion: 'running',
    checkedAt: '2026-09-17T11:59:00Z',
    ...over,
  });

  it('asks about a commit nothing is known about', () => {
    expect(shouldRecheck(undefined, now)).toBe(true);
  });

  it('never asks again once the answer is passed or failed', () => {
    expect(shouldRecheck(check({ conclusion: 'passed' }), now)).toBe(false);
    expect(shouldRecheck(check({ conclusion: 'failed' }), now)).toBe(false);
  });

  it('leaves a run read a minute ago alone', () => {
    expect(shouldRecheck(check({}), now)).toBe(false);
  });

  it('asks again about a run, and about a branch that had not landed', () => {
    const old = '2026-09-17T11:40:00Z';
    expect(shouldRecheck(check({ checkedAt: old }), now)).toBe(true);
    expect(shouldRecheck(check({ conclusion: 'unmerged', checkedAt: old }), now)).toBe(true);
  });
});

describe('shouldRecheck on a merge that ran no checks', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  const none = (checkedAt: string): CommitCheck => ({
    mergeSha: 'm2',
    conclusion: 'none',
    checkedAt,
  });

  it('stops asking once none was read a day after the step closed', () => {
    expect(shouldRecheck(none('2026-09-22T12:00:00Z'), now, '2026-09-10T01:45:00Z')).toBe(false);
  });

  it('keeps asking while the step closed less than a day before the reading', () => {
    expect(shouldRecheck(none('2026-09-24T11:00:00Z'), now, '2026-09-24T05:00:00Z')).toBe(true);
  });

  it('keeps asking every ten minutes when nobody says when the step closed', () => {
    expect(shouldRecheck(none('2026-09-22T12:00:00Z'), now)).toBe(true);
  });

  it('does not settle a run still going, however old', () => {
    const running: CommitCheck = { ...none('2026-09-22T12:00:00Z'), conclusion: 'running' };
    expect(shouldRecheck(running, now, '2026-09-10T01:45:00Z')).toBe(true);
  });
});

describe('what the page says', () => {
  const check = (conclusion: CommitCheck['conclusion']): CommitCheck => ({
    mergeSha: 'm2',
    conclusion,
    checkedAt: '2026-09-17T11:59:00Z',
  });

  it('marks a step with no answer rather than leaving it looking green', () => {
    expect(checkWord(undefined)).toBe('Not checked');
    expect(checkLine(undefined)).toBe('Checks not read yet');
  });

  it('marks a red commit and leaves a green one unmarked', () => {
    expect(checkWord(check('failed'))).toBe('CI failed');
    expect(checkWord(check('passed'))).toBeNull();
    expect(checkLine(check('passed'))).toBe('Checks passed');
  });

  it('tells a commit with no checks from one that never landed', () => {
    expect(checkWord(check('none'))).toBe('No checks');
    expect(checkWord(check('unmerged'))).toBe('Not on main');
  });
});
