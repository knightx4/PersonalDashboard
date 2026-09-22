import { describe, expect, it } from 'vitest';
import {
  countLabel,
  formatArrival,
  issueReturn,
  senderLabel,
  sortSenders,
  visibleIssues,
  type NewsIssue,
  type NewsSender,
} from '@/lib/news/issues/list';

const paper: NewsSender = { id: 's1', email: 'hello@thepaper.com', name: 'The Paper', muted: false };
const weekly: NewsSender = { id: 's2', email: 'wk@weekly.com', name: null, muted: true };

function issue(id: string, senderId: string, over: Partial<NewsIssue> = {}): NewsIssue {
  return {
    id,
    senderId,
    subject: 'This week',
    receivedAt: '2026-05-01T09:00:00Z',
    readAt: null,
    ...over,
  };
}

describe('visibleIssues', () => {
  const issues = [issue('a', 's1'), issue('b', 's2'), issue('c', 's1')];

  it('leaves out a muted sender when nothing is filtered', () => {
    expect(visibleIssues(issues, [paper, weekly], null).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('shows a muted sender when it is the one being asked for', () => {
    expect(visibleIssues(issues, [paper, weekly], 's2').map((i) => i.id)).toEqual(['b']);
  });

  it('narrows to one sender', () => {
    expect(visibleIssues(issues, [paper, weekly], 's1').map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('keeps the order it was given, which is newest first', () => {
    const newest = [issue('new', 's1'), issue('old', 's1', { receivedAt: '2026-04-01T09:00:00Z' })];
    expect(visibleIssues(newest, [paper], null).map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('senderLabel', () => {
  it('prefers the name it gave', () => {
    expect(senderLabel(paper)).toBe('The Paper');
  });

  it('falls back to the address when it gave none', () => {
    expect(senderLabel(weekly)).toBe('wk@weekly.com');
  });
});

describe('sortSenders', () => {
  it('sorts by what they are called, ignoring case', () => {
    const zed: NewsSender = { id: 's3', email: 'a@z.com', name: 'zed', muted: false };
    expect(sortSenders([zed, paper, weekly]).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('does not touch what it was given', () => {
    const given = [weekly, paper];
    sortSenders(given);
    expect(given.map((s) => s.id)).toEqual(['s2', 's1']);
  });
});

describe('formatArrival', () => {
  it('says the day and the hour, in the account timezone', () => {
    expect(formatArrival('2026-05-01T09:00:00Z', 'UTC')).toBe('1 May, 09:00');
    expect(formatArrival('2026-05-01T09:00:00Z', 'America/New_York')).toBe('1 May, 05:00');
  });

  it('falls back to a dash rather than throwing on a zone nobody has', () => {
    expect(formatArrival('2026-05-01T09:00:00Z', 'Mars/Olympus')).toBe('1 May, 09:00');
    expect(formatArrival('not a date', 'UTC')).toBe('—');
  });
});

describe('countLabel', () => {
  it('counts one and many', () => {
    expect(countLabel(1)).toBe('1 newsletter');
    expect(countLabel(4)).toBe('4 newsletters');
  });
});

describe('issueReturn', () => {
  it('goes back to the whole list when that is where you were', () => {
    expect(issueReturn(undefined, paper)).toEqual({
      href: '/news',
      label: 'Newsletters',
      from: null,
    });
  });

  it('goes back to the sender list when that is where you were', () => {
    expect(issueReturn('s1', paper)).toEqual({
      href: '/news?from=s1',
      label: 'The Paper',
      from: 's1',
    });
  });

  it('ignores a filter that names another sender, or none at all', () => {
    expect(issueReturn('s2', paper).href).toBe('/news');
    expect(issueReturn('s1', null).href).toBe('/news');
  });
});
