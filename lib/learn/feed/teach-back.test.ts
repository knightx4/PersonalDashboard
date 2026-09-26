import { describe, expect, it } from 'vitest';
import { toFeedCard, type FeedCardRow } from './card';
import { cardMaterial } from './ask';
import {
  explanationReply,
  followUpReply,
  isTeachBackRate,
  parseTeachBack,
  pickTeachBackIdea,
  teachBackDue,
  teachBackPrompt,
  teachBackState,
  teachBackView,
  teachBackWhy,
  type TeachBackRecord,
} from './teach-back';

/**
 * Explaining an idea back (plan #1054): when one is due, which idea it asks
 * about, where the answers leave the idea, and what the card shows.
 */

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-09-26T12:00:00Z');
const daysAgo = (days: number) => new Date(now - days * DAY).toISOString();

describe('when a teach-back is due', () => {
  it('comes after nine other cards at one in ten', () => {
    expect(teachBackDue({ every: 10, writtenSince: 8, waiting: false })).toBe(false);
    expect(teachBackDue({ every: 10, writtenSince: 9, waiting: false })).toBe(true);
    expect(teachBackDue({ every: 20, writtenSince: 9, waiting: false })).toBe(false);
  });

  it('never comes when turned off, or while one is still waiting', () => {
    expect(teachBackDue({ every: 0, writtenSince: 100, waiting: false })).toBe(false);
    expect(teachBackDue({ every: 10, writtenSince: 100, waiting: true })).toBe(false);
  });

  it('offers five choices, one of them off', () => {
    expect(isTeachBackRate(10)).toBe(true);
    expect(isTeachBackRate(0)).toBe(true);
    expect(isTeachBackRate(7)).toBe(false);
    expect(isTeachBackRate('10')).toBe(false);
  });
});

describe('which idea it asks about', () => {
  const none = { askedRecently: new Set<string>(), sharp: new Set<string>() };

  it('takes the idea kept longest ago, once it is three days old', () => {
    const kept = [
      { conceptId: 'recent', actedAt: daysAgo(1) },
      { conceptId: 'week', actedAt: daysAgo(7) },
      { conceptId: 'fortnight', actedAt: daysAgo(14) },
    ];
    expect(pickTeachBackIdea(kept, none, now)?.conceptId).toBe('fortnight');
    expect(pickTeachBackIdea([kept[0]!], none, now)).toBeNull();
  });

  it('skips an idea asked about lately and one already sharp', () => {
    const kept = [
      { conceptId: 'asked', actedAt: daysAgo(20) },
      { conceptId: 'sharp', actedAt: daysAgo(10) },
      { conceptId: 'week', actedAt: daysAgo(7) },
    ];
    const exclude = { askedRecently: new Set(['asked']), sharp: new Set(['sharp']) };
    expect(pickTeachBackIdea(kept, exclude, now)?.conceptId).toBe('week');
  });
});

describe('where the answers leave the idea', () => {
  it('is shaky when the explanation does not hold, whatever the follow-up', () => {
    expect(teachBackState(false, null)).toBe('shaky');
    expect(teachBackState(false, true)).toBe('shaky');
  });

  it('is known once the explanation holds, and sharp once it survives the follow-up', () => {
    expect(teachBackState(true, null)).toBe('known');
    expect(teachBackState(true, false)).toBe('known');
    expect(teachBackState(true, true)).toBe('sharp');
  });
});

const marking = {
  holds: true,
  right: ['you said it searches ahead of the current position'],
  missing: ['why the value network cuts the search down'],
  why: 'The mechanism is there; the pruning is not.',
  ownExample: false,
};

const record: TeachBackRecord = {
  stage: 'follow_up',
  explanation: 'It looks ahead at moves.',
  explained: marking,
  followUp: 'Why can it not search every move?',
  followUpExpected: 'There are too many positions; the networks narrow it.',
  state: 'known',
};

describe('the thread', () => {
  it('says what was right, what was missing, the example and the follow-up', () => {
    const reply = explanationReply(marking, record.followUp);
    expect(reply).toContain('What you got right:\n- you said it searches ahead');
    expect(reply).toContain('What was missing:\n- why the value network');
    expect(reply).toContain('You did not give an example of your own.');
    expect(reply).toContain('One follow-up: Why can it not search every move?');
  });

  it('ends the follow-up marking on where it leaves the idea', () => {
    const reply = followUpReply({ ...marking, missing: [] }, 'Tree search', 'sharp');
    expect(reply).not.toContain('What was missing');
    expect(reply.endsWith('Tree search is now marked sharp.')).toBe(true);
  });

  it('asks as if to a friend and dates the idea', () => {
    expect(teachBackPrompt(' Tree search ')).toMatch(/^Explain Tree search to a friend/);
    expect(teachBackWhy('2026-09-19T08:00:00Z')).toBe('You kept this idea on 19 September.');
  });
});

describe('the stored exchange', () => {
  it('reads back what was written and refuses anything else', () => {
    expect(parseTeachBack(record)).toEqual(record);
    expect(parseTeachBack(null)).toBeNull();
    expect(parseTeachBack({ stage: 'follow_up' })).toBeNull();
  });

  it('shows the claim only once the exchange is over', () => {
    expect(teachBackView('c1', 'The claim.', null)).toEqual({
      conceptId: 'c1',
      stage: 'explain',
      state: null,
      claim: null,
    });
    expect(teachBackView('c1', 'The claim.', record).claim).toBeNull();
    expect(teachBackView('c1', 'The claim.', { ...record, stage: 'done', state: 'sharp' })).toEqual({
      conceptId: 'c1',
      stage: 'done',
      state: 'sharp',
      claim: 'The claim.',
    });
  });
});

describe('the card', () => {
  const row: FeedCardRow = {
    id: 't1',
    reason: 'teach_back',
    status: 'ready',
    concept_id: 'c1',
    idea_name: 'Tree search',
    summary: 'Searching ahead beats judging a position alone.',
    why: 'You kept this idea on 19 September.',
    context: 'Write it from memory.',
    hook: 'Explain Tree search to a friend.',
    item: null,
    segment: null,
    teach_back: null,
  };

  it('is a teach card with the question and none of the answer', () => {
    const card = toFeedCard(row)!;
    expect(card.kind).toBe('teach');
    expect(card.question).toBe('Explain Tree search to a friend.');
    expect(card.summary).toBe('');
    expect(card.teach).toEqual({ conceptId: 'c1', stage: 'explain', state: null, claim: null });
    expect(JSON.stringify(card)).not.toContain('Searching ahead');
  });

  it('gives Ask and phrase explanations nothing to work from', () => {
    expect(cardMaterial(row)).toBeNull();
  });

  it('is not shown without its idea', () => {
    expect(toFeedCard({ ...row, concept_id: null })).toBeNull();
  });
});
