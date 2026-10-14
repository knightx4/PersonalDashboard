import { describe, expect, it } from 'vitest';
import {
  checkDue,
  chooseNewSources,
  MONTH_MS,
  nextCheckAt,
  NEW_MAX,
  publishedAt,
  quietAfter,
  readWatchList,
  watchLine,
  watchPrompt,
  WEEK_MS,
  type WatchState,
} from './watch';
import { foundLine, isNewSource, sourcesFoundSince, type BriefSource } from './view';

const NOW = Date.parse('2026-10-14T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function state(over: Partial<WatchState> = {}): WatchState {
  return {
    watchOn: true,
    archivedAt: null,
    status: 'ready',
    watchedAt: new Date(NOW - 8 * DAY).toISOString(),
    quietChecks: 0,
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

describe('when a brief is checked', () => {
  it('checks a watched brief whose last check is more than a week old', () => {
    expect(checkDue(state(), NOW)).toBe(true);
    expect(checkDue(state({ watchedAt: new Date(NOW - 6 * DAY).toISOString() }), NOW)).toBe(false);
  });

  it('never checks a brief with the switch off, archived, or not ready', () => {
    expect(checkDue(state({ watchOn: false }), NOW)).toBe(false);
    expect(checkDue(state({ archivedAt: '2026-10-01T00:00:00Z' }), NOW)).toBe(false);
    expect(checkDue(state({ status: 'failed' }), NOW)).toBe(false);
    expect(checkDue(state({ status: 'researching' }), NOW)).toBe(false);
  });

  it('counts a brief never checked from when it was made', () => {
    const made = new Date(NOW - 3 * DAY).toISOString();
    expect(checkDue(state({ watchedAt: null, createdAt: made }), NOW)).toBe(false);
    expect(nextCheckAt(state({ watchedAt: null, createdAt: made }))).toBe(Date.parse(made) + WEEK_MS);
  });

  it('goes monthly after four quiet checks in a row', () => {
    expect(quietAfter(3, 0)).toBe(4);
    expect(quietAfter(5, 2)).toBe(0);
    const quiet = state({ quietChecks: 4 });
    expect(checkDue(quiet, NOW)).toBe(false);
    expect(nextCheckAt(quiet)).toBe(Date.parse(quiet.watchedAt!) + MONTH_MS);
    expect(checkDue(state({ quietChecks: 4, watchedAt: new Date(NOW - 31 * DAY).toISOString() }), NOW)).toBe(true);
    expect(watchLine(quiet)).toMatch(/so now monthly$/);
    expect(watchLine(state({ watchedAt: null }))).toBe('Not checked yet');
  });
});

describe('the check call', () => {
  it('names the date and every link already on the list', () => {
    const prompt = watchPrompt({
      question: 'How do SOX controls apply to AI?',
      angle: 'An interview next month',
      subQuestions: [{ id: 'q1', text: 'What do auditors test?' }],
      shortAnswer: 'Controls over AI are tested like other IT general controls.',
      since: '2026-10-01T12:00:00Z',
      known: ['https://pcaobus.org/a', 'https://example.org/b'],
    });
    expect(prompt).toContain('after 2026-10-01');
    expect(prompt).toContain('- https://pcaobus.org/a');
    expect(prompt).toContain('The answer so far:');
  });

  it('reads the listed sources with their change lines, and NOTHING NEW as none', () => {
    const listed = readWatchList(
      [
        'SOURCE: https://pcaobus.org/new-guidance',
        'KIND: regulator',
        'WHY: The board says how it will inspect AI controls.',
        'SUMMARY: Staff guidance on testing',
        'model-driven controls.',
        'CHANGES: Adds that inspectors now ask for model change logs,',
        'which the answer did not mention.',
      ].join('\n'),
    );
    expect(listed).toEqual([
      {
        url: 'https://pcaobus.org/new-guidance',
        kind: 'regulator',
        why: 'The board says how it will inspect AI controls.',
        summary: 'Staff guidance on testing model-driven controls.',
        change: 'Adds that inspectors now ask for model change logs, which the answer did not mention.',
      },
    ]);
    expect(readWatchList('NOTHING NEW')).toEqual([]);
  });

  it('reads a page age as a date or an age', () => {
    expect(publishedAt('3 days ago', NOW)).toBe(NOW - 3 * DAY);
    expect(publishedAt('October 2, 2026', NOW)).toBe(Date.parse('October 2, 2026'));
    expect(publishedAt('sometime', NOW)).toBeNull();
    expect(publishedAt(null, NOW)).toBeNull();
  });
});

describe('which sources a check adds', () => {
  const since = Date.parse('2026-10-01T00:00:00Z');
  const listed = (url: string, change = 'Adds a new rule.') => ({ url, kind: null, why: 'Why.', summary: 'Says.', change });
  const result = (url: string, pageAge: string | null = null) => ({ url, title: `Title of ${url}`, pageAge });

  it('skips a source already on the list by its link', () => {
    const chosen = chooseNewSources({
      listed: [listed('https://a.org/x'), listed('https://b.org/y')],
      results: [result('https://a.org/x'), result('https://b.org/y')],
      known: ['https://a.org/x#section'],
      since,
      now: NOW,
    });
    expect(chosen.map((s) => s.url)).toEqual(['https://b.org/y']);
  });

  it('keeps only pages a search returned, over https, not dated before the last check', () => {
    const chosen = chooseNewSources({
      listed: [
        listed('https://made-up.org/z'),
        listed('http://plain.org/a'),
        listed('https://old.org/a'),
        listed('https://new.org/a'),
        listed('https://undated.org/a'),
      ],
      results: [
        result('http://plain.org/a'),
        result('https://old.org/a', 'September 1, 2026'),
        result('https://new.org/a', '2 days ago'),
        result('https://undated.org/a'),
      ],
      known: [],
      since,
      now: NOW,
    });
    expect(chosen.map((s) => s.url)).toEqual(['https://new.org/a', 'https://undated.org/a']);
    expect(chosen[0]).toMatchObject({ title: 'Title of https://new.org/a', kind: 'press', change: 'Adds a new rule.' });
  });

  it('leaves out a source with no line on what it changes, and adds at most three', () => {
    const urls = ['https://a.gov/1', 'https://a.gov/2', 'https://a.gov/3', 'https://a.gov/4', 'https://a.gov/5'];
    const chosen = chooseNewSources({
      listed: [listed(urls[0], ''), ...urls.slice(1).map((u) => listed(u))],
      results: urls.map((u) => result(u)),
      known: [],
      since,
      now: NOW,
    });
    expect(chosen).toHaveLength(NEW_MAX);
    expect(chosen[0].url).toBe(urls[1]);
    expect(chosen[0].kind).toBe('regulator');
  });
});

describe('the brief page', () => {
  const source = (id: string, over: Partial<BriefSource> = {}): BriefSource => ({
    readingId: id,
    title: id,
    kind: null,
    year: null,
    foundAt: null,
    url: null,
    ...over,
  });

  it('lists the sources checks found, newest first, and marks them new until opened', () => {
    const found = sourcesFoundSince({
      a: source('a'),
      b: source('b', { change: 'Older', foundAt: '2026-10-01T00:00:00Z' }),
      c: source('c', { change: 'Newer', foundAt: '2026-10-08T00:00:00Z' }),
    });
    expect(found.map((s) => s.readingId)).toEqual(['c', 'b']);
    expect(isNewSource('Adds a rule.', 'queued')).toBe(true);
    expect(isNewSource('Adds a rule.', 'reading')).toBe(false);
    expect(isNewSource(null, 'queued')).toBe(false);
  });

  it('dates a source a check found by the day found and the year published', () => {
    expect(foundLine(source('a', { kind: 'regulator', year: 2026, foundAt: '2026-10-13T06:00:00Z' }))).toBe(
      'Regulator · found 13 Oct 2026 · published 2026',
    );
  });
});
