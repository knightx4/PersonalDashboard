import { describe, expect, it } from 'vitest';
import { healthOf, moveFor, type HealthFacts } from './health-words';

const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  closed: false,
  openBeneath: [],
  resolution: null,
  blockAsk: null,
  comment: null,
  waitingOn: [],
  ...over,
});

describe('healthOf', () => {
  it('words a state with its glyph and fixed tooltip', () => {
    const word = healthOf('proposed', facts());
    expect(word).toMatchObject({ word: 'Proposed', tone: 'caution', name: 'proposed' });
    expect(word.title).toMatch(/Approve it/);
  });

  it('names what a waiting step waits on', () => {
    const word = healthOf('waiting', facts({ waitingOn: [{ number: 12, title: 'Schema' }] }));
    expect(word.title).toBe('Waits on #12 Schema');
  });

  it('says what a blocked step needs, and falls back to its note', () => {
    expect(healthOf('blocked', facts({ blockAsk: 'Which account?' })).title).toBe('Which account?');
    expect(healthOf('blocked', facts({ comment: 'A note' })).title).toBe('A note');
  });

  it('names the open steps under a closed row, three at most', () => {
    const open = [1, 2, 3, 4, 5].map((n) => ({ number: n, title: `Step ${n}` }));
    const word = healthOf('ready', facts({ closed: true, openBeneath: open }));
    expect(word.title).toBe(
      'Closed, but still open beneath it: #1 Step 1, #2 Step 2, #3 Step 3, and 2 more',
    );
  });
});

describe('moveFor', () => {
  it('says when the word came from a step beneath', () => {
    expect(moveFor('with_dash', 'with_dash').title).toBe('A session is working on this now.');
    expect(moveFor('with_dash', 'none').title).toMatch(/\(from a step beneath this one\.\)$/);
    expect(moveFor('on_you', 'on_you').tone).toBe('caution');
  });
});
