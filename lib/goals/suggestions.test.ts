import { describe, expect, it } from 'vitest';
import {
  didYouGoSuggestions,
  helpGoals,
  homeSuggestions,
  ignoredBefore,
  pastLine,
  ranThisWeek,
  todoSuggestions,
  toSuggestion,
  weeklyRunText,
  type HelpGoal,
  type Suggestion,
} from '@/lib/goals/suggestions';
import type { Goal } from '@/lib/goals/tree';

function suggestion(over: Partial<Suggestion>): Suggestion {
  return {
    id: 's',
    itemId: null,
    kind: 'events',
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
  const RHYTHM = {
    id: 'r1',
    title: 'One city event',
    target: 1,
    period: 'week' as const,
    goalId: 'g',
    goalTitle: 'Get plugged into city life',
  };
  const CITY: HelpGoal = {
    id: 'g',
    title: 'Get plugged into city life',
    helpKinds: [
      { kind: 'events', note: 'Brooklyn, weeknights' },
      { kind: 'volunteering', note: null },
    ],
    rhythms: [RHYTHM],
  };
  const LEARNING: HelpGoal = {
    id: 'l',
    title: 'Learn how cities are planned',
    helpKinds: [{ kind: 'reading', note: 'urban planning history' }],
    rhythms: [],
  };

  it('names each goal with its kinds and notes, its rhythms, and the run', () => {
    const text = weeklyRunText({ userId: 'u1', runId: 'run-9', review: [], goals: [CITY, LEARNING], past: [] });
    expect(text).toContain(
      'Goal "Get plugged into city life" (goals.items id g) asks for:\n- events: Brooklyn, weeknights\n- volunteering\n',
    );
    expect(text).toContain('Its live rhythms:\n- "One city event" (goals.items id r1), 1 a week');
    expect(text).toContain('Goal "Learn how cities are planned" (goals.items id l) asks for:\n- reading: urban planning history');
    expect(text).toContain('goals.runs id run-9');
    expect(text).toContain('user_id u1');
    expect(text).toContain('kind set to the kind it answers');
  });

  it('lists past reactions under their kind, and only for the kinds asked for', () => {
    const text = weeklyRunText({
      userId: 'u1',
      runId: 'run-9',
      review: [],
      goals: [CITY, LEARNING],
      past: [
        suggestion({ title: 'Jazz at the park', reaction: 'going', attended: true, source: 'NYC Parks' }),
        suggestion({ title: 'The Power Broker', kind: 'reading', reaction: 'not_for_me', happensOn: null }),
        suggestion({ title: 'Book launch', reaction: 'ignored', happensOn: null }),
        suggestion({ title: 'Python course', kind: 'courses', reaction: 'going' }),
      ],
    });
    expect(text).toContain(
      'events:\n- going, and went: "Jazz at the park" (NYC Parks, 2026-09-30)\n- ignored: "Book launch"\n',
    );
    expect(text).toContain('volunteering:\n- Nothing yet for this kind.');
    expect(text).toContain('reading:\n- not_for_me: "The Power Broker"\n');
    expect(text).not.toContain('Python course');
    expect(text.indexOf('\nevents:\n')).toBeLessThan(text.indexOf('\nvolunteering:\n'));
    expect(text.indexOf('\nvolunteering:\n')).toBeLessThan(text.indexOf('\nreading:\n'));
  });

  it('reviews every open goal first, and says so when there is nothing to research', () => {
    const text = weeklyRunText({
      userId: 'u1',
      runId: 'run-9',
      review: [
        {
          id: 'q',
          title: 'Sleep by eleven',
          acceptance: 'Asleep by eleven five nights a week for a month.',
          lastDoneAt: null,
          quietDays: 30,
          stalled: true,
          last: null,
        },
      ],
      goals: [],
      past: [],
    });
    expect(text).toContain('review every open goal below against its done-when');
    expect(text).toContain('Goal "Sleep by eleven" (goals.items id q)\n- Done when: Asleep by eleven');
    expect(text).toContain('the verdict is stalled, with its next step added under it');
    expect(text).toContain('nothing to research');
    expect(text).not.toContain('What you suggested before');
    expect(text).toContain('run_id on every review and\nsuggestion');
  });

  it('reads a start time before a bare date', () => {
    expect(pastLine(suggestion({ startsAt: '2026-09-30T22:30:00+00:00' }))).toContain('2026-09-30 22:30');
  });
});

describe('helpGoals', () => {
  function goal(over: Partial<Goal>): Goal {
    return {
      id: 'g',
      areaId: 'a',
      title: 'A goal',
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
      helpKinds: [],
      ...over,
    };
  }

  it('keeps open goals that ask for help, with their own rhythms', () => {
    const rhythm = { id: 'r', title: 'R', target: 1, period: 'week' as const, goalId: 'city', goalTitle: 'City' };
    const other = { ...rhythm, id: 'r2', goalId: 'quiet' };
    const out = helpGoals(
      [
        goal({ id: 'city', helpKinds: [{ kind: 'events', note: null }] }),
        goal({ id: 'quiet' }),
        goal({ id: 'done', status: 'done', helpKinds: [{ kind: 'reading', note: null }] }),
      ],
      [rhythm, other],
    );
    expect(out.map((g) => g.id)).toEqual(['city']);
    expect(out[0].rhythms.map((r) => r.id)).toEqual(['r']);
  });
});

describe('toSuggestion', () => {
  it('files a row with an unknown kind under events', () => {
    const s = toSuggestion({
      id: 'x',
      item_id: null,
      kind: 'gigs',
      title: 't',
      detail: null,
      url: null,
      place: null,
      source: null,
      happens_on: null,
      starts_at: null,
      reaction: null,
      attended: null,
      created_at: '2026-09-24T00:00:00Z',
    });
    expect(s.kind).toBe('events');
  });

  it('drops a reaction it does not know rather than passing it on', () => {
    const s = toSuggestion({
      id: 'x',
      item_id: null,
      kind: 'events',
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

describe('did you go', () => {
  const today = '2026-10-01';

  it('asks from the day after an event you said you were going to, most recent first', () => {
    const out = didYouGoSuggestions(
      [
        suggestion({ id: 'today', reaction: 'going', happensOn: '2026-10-01' }),
        suggestion({ id: 'yesterday', reaction: 'going', happensOn: '2026-09-30' }),
        suggestion({ id: 'last-week', reaction: 'going', happensOn: '2026-09-24' }),
      ],
      today,
    );
    expect(out.map((s) => s.id)).toEqual(['yesterday', 'last-week']);
  });

  it('does not ask once answered, when not going, when undated or when long past', () => {
    const out = didYouGoSuggestions(
      [
        suggestion({ id: 'went', reaction: 'going', attended: true, happensOn: '2026-09-30' }),
        suggestion({ id: 'did-not', reaction: 'going', attended: false, happensOn: '2026-09-30' }),
        suggestion({ id: 'ignored', reaction: 'ignored', happensOn: '2026-09-30' }),
        suggestion({ id: 'undated', reaction: 'going', happensOn: null }),
        suggestion({ id: 'edge', reaction: 'going', happensOn: '2026-09-17' }),
        suggestion({ id: 'old', reaction: 'going', happensOn: '2026-09-16' }),
      ],
      today,
    );
    expect(out.map((s) => s.id)).toEqual(['edge']);
  });

  it('reads a yes into the next brief as went, and a no as did not go', () => {
    expect(pastLine(suggestion({ title: 'A talk', reaction: 'going', attended: true }))).toContain(
      'going, and went: "A talk"',
    );
    expect(pastLine(suggestion({ title: 'A talk', reaction: 'going', attended: false }))).toContain(
      'going, and did not go',
    );
  });
});
