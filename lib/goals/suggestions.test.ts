import { describe, expect, it } from 'vitest';
import {
  homeSuggestions,
  ignoredBefore,
  pastLine,
  ranThisWeek,
  todoSuggestions,
  toSuggestion,
  weeklyRunText,
  type Suggestion,
} from '@/lib/goals/suggestions';

function suggestion(over: Partial<Suggestion>): Suggestion {
  return {
    id: 's',
    itemId: null,
    title: 'A talk',
    detail: null,
    url: 'https://example.test/talk',
    place: null,
    source: null,
    happensOn: '2026-09-30',
    startsAt: null,
    reaction: null,
    attended: null,
    createdAt: '2026-09-24T12:05:00Z',
    ...over,
  };
}

const NOW = Date.parse('2026-10-01T12:00:00Z');

describe('the week', () => {
  it('runs once a week, and again on the seventh day even when the cron fires early', () => {
    expect(ranThisWeek(null, NOW)).toBe(false);
    expect(ranThisWeek('2026-09-30T12:00:00Z', NOW)).toBe(true);
    expect(ranThisWeek('2026-09-24T12:30:00Z', NOW)).toBe(false);
  });

  it('closes last week’s suggestions on the morning this week’s run starts', () => {
    const cutoff = ignoredBefore(NOW);
    expect('2026-09-24T12:05:00Z' < cutoff).toBe(true);
    expect('2026-09-30T12:05:00Z' < cutoff).toBe(false);
  });
});

describe('where a suggestion shows', () => {
  it('lists the ones not turned down and not yet past on the home, soonest first', () => {
    const list = homeSuggestions(
      [
        suggestion({ id: 'late', happensOn: '2026-10-05' }),
        suggestion({ id: 'undated', happensOn: null }),
        suggestion({ id: 'no', reaction: 'not_for_me' }),
        suggestion({ id: 'past', happensOn: '2026-09-20' }),
        suggestion({ id: 'soon', happensOn: '2026-10-02', reaction: 'going' }),
        suggestion({ id: 'ignored', happensOn: '2026-10-03', reaction: 'ignored' }),
      ],
      '2026-10-01',
    );
    expect(list.map((s) => s.id)).toEqual(['soon', 'ignored', 'late', 'undated']);
  });

  it('puts going on Todo on its date, until you tick it or the day passes', () => {
    const list = todoSuggestions(
      [
        suggestion({ id: 'going', reaction: 'going', happensOn: '2026-10-03' }),
        suggestion({ id: 'went', reaction: 'going', attended: true }),
        suggestion({ id: 'past', reaction: 'going', happensOn: '2026-09-28' }),
        suggestion({ id: 'far', reaction: 'going', happensOn: '2026-12-01' }),
        suggestion({ id: 'undated', reaction: 'going', happensOn: null }),
        suggestion({ id: 'unanswered' }),
      ],
      '2026-10-01',
      '2026-10-14',
    );
    expect(list.map((s) => s.id)).toEqual(['going', 'undated']);
  });
});

describe('the brief', () => {
  it('names the rhythms, the run, and every past reaction', () => {
    const text = weeklyRunText({
      userId: 'u1',
      runId: 'run-9',
      rhythms: [
        { id: 'r1', title: 'One city event', target: 1, period: 'week', goalId: 'g', goalTitle: 'Get plugged into city life' },
      ],
      past: [
        suggestion({ title: 'Jazz at the park', reaction: 'going', attended: true, source: 'NYC Parks' }),
        suggestion({ title: 'Crypto meetup', reaction: 'not_for_me' }),
        suggestion({ title: 'Book launch', reaction: 'ignored', happensOn: null }),
      ],
    });
    expect(text).toContain('"One city event" (goals.items id r1), 1 a week');
    expect(text).toContain('- going, and went: "Jazz at the park" (NYC Parks, 2026-09-30)');
    expect(text).toContain('- not_for_me: "Crypto meetup"');
    expect(text).toContain('- ignored: "Book launch"');
    expect(text).toContain('goals.runs id run-9');
    expect(text).toContain('user_id u1');
  });

  it('says when there is nothing to learn from yet', () => {
    const text = weeklyRunText({ userId: 'u', runId: 'r', rhythms: [], past: [] });
    expect(text).toContain('this is the first week');
  });

  it('reads a start time before a bare date', () => {
    expect(pastLine(suggestion({ startsAt: '2026-09-30T22:30:00+00:00' }))).toContain('2026-09-30 22:30');
  });
});

describe('toSuggestion', () => {
  it('drops a reaction it does not know rather than passing it on', () => {
    const s = toSuggestion({
      id: 'x',
      item_id: null,
      title: 't',
      detail: null,
      url: null,
      place: null,
      source: null,
      happens_on: null,
      starts_at: null,
      reaction: 'maybe',
      attended: null,
      created_at: '2026-09-24T00:00:00Z',
    });
    expect(s.reaction).toBeNull();
  });
});
