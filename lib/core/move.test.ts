import { describe, expect, it } from 'vitest';
import { MOVE_STATES, MOVE_WORD, moveInline, moveLabel, moveWord, rowRef, withRun, workingMove } from '@/lib/core/move';

describe('moves', () => {
  it('has a word for each of the five states', () => {
    expect(MOVE_STATES.map((state) => MOVE_WORD[state])).toEqual([
      'On you',
      'With Dash',
      'Dash is on it',
      'Waiting',
      'Done',
    ]);
  });

  it('names who a waiting row is waiting on', () => {
    expect(moveWord({ state: 'waiting', waitingOn: 'recruiter at Contoso' })).toBe(
      'Waiting on recruiter at Contoso',
    );
    expect(
      moveWord({ state: 'waiting', waitingOn: { ref: 'job_search.companies:1', title: 'Contoso' } }),
    ).toBe('Waiting on Contoso');
    expect(moveWord({ state: 'waiting', waitingOn: ' ' })).toBe('Waiting');
    expect(moveLabel({ state: 'dash_working' })).toMatchObject({ word: 'Dash is on it', tone: 'info' });
  });

  it('keeps the capital on Dash inside a sentence', () => {
    expect(moveInline('on_you')).toBe('on you');
    expect(moveInline('with_dash')).toBe('with Dash');
    expect(moveInline('dash_working')).toBe('Dash is on it');
  });
});

describe('withRun (plan #1568)', () => {
  const own = { move: { state: 'on_you' as const }, title: 'Yours to do.' };

  it('says Dash is on it when a run is about one of the row\'s refs', () => {
    expect(withRun(own, ['todo.tasks:t1'], [rowRef('todo.tasks', 't1')])?.move.state).toBe('dash_working');
    expect(withRun(own, new Set(['public.orders:o1']), [null, 'public.orders:o1'])?.move.state).toBe('dash_working');
  });

  it('keeps the row\'s own move otherwise, and no move stays none', () => {
    expect(withRun(own, ['todo.tasks:t2'], ['todo.tasks:t1'])).toBe(own);
    expect(withRun(own, undefined, ['todo.tasks:t1'])).toBe(own);
    expect(withRun(null, ['todo.tasks:t1'], ['todo.tasks:t1'])).toBeNull();
    expect(rowRef('public.returns', null)).toBeNull();
  });
});

describe('workingMove (plan #1964.2.2)', () => {
  it('says Dash is on it on a row with no move of its own only while something is about it', () => {
    expect(workingMove(['learn.readings:r1'], [rowRef('learn.readings', 'r1')])?.move.state).toBe('dash_working');
    expect(workingMove(['obsidian.notes:Plans/Job.md'], ['obsidian.notes:n1', 'obsidian.notes:Plans/Job.md'])).not.toBeNull();
    expect(workingMove(['learn.readings:r2'], ['learn.readings:r1'])).toBeNull();
    expect(workingMove(undefined, ['learn.readings:r1'])).toBeNull();
  });
});
