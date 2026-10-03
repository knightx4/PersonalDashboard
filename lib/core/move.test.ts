import { describe, expect, it } from 'vitest';
import { MOVE_STATES, MOVE_WORD, moveInline, moveLabel, moveWord } from '@/lib/core/move';

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
    expect(moveWord({ state: 'waiting', waitingOn: 'recruiter at EliseAI' })).toBe(
      'Waiting on recruiter at EliseAI',
    );
    expect(
      moveWord({ state: 'waiting', waitingOn: { ref: 'job_search.companies:1', title: 'EliseAI' } }),
    ).toBe('Waiting on EliseAI');
    expect(moveWord({ state: 'waiting', waitingOn: ' ' })).toBe('Waiting');
    expect(moveLabel({ state: 'dash_working' })).toMatchObject({ word: 'Dash is on it', tone: 'info' });
  });

  it('keeps the capital on Dash inside a sentence', () => {
    expect(moveInline('on_you')).toBe('on you');
    expect(moveInline('with_dash')).toBe('with Dash');
    expect(moveInline('dash_working')).toBe('Dash is on it');
  });
});
