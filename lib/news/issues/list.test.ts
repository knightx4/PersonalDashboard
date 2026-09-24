import { describe, expect, it } from 'vitest';
import {
  countLabel,
  formatArrival,
  issueHref,
  issueReturn,
  listHref,
  newsletterRows,
  readListView,
  senderLabel,
  sortSenders,
  unreadTopics,
  visibleIssues,
  type NewsIssue,
  type NewsSender,
} from '@/lib/news/issues/list';

const paper: NewsSender = {
  id: 's1',
  email: 'hello@thepaper.com',
  name: 'The Paper',
  muted: false,
};
const weekly: NewsSender = { id: 's2', email: 'wk@weekly.com', name: null, muted: true };

function issue(id: string, senderId: string, over: Partial<NewsIssue> = {}): NewsIssue {
  return {
    id,
    senderId,
    subject: 'This week',
    receivedAt: '2026-05-01T09:00:00Z',
    readAt: null,
    summaryLine: null,
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
      href: '/news/all',
      label: 'Newsletters',
      from: null,
    });
  });

  it('goes back to the sender list when that is where you were', () => {
    expect(issueReturn('s1', paper)).toEqual({
      href: '/news/all?from=s1',
      label: 'The Paper',
      from: 's1',
    });
  });

  it('ignores a filter that names another sender, or none at all', () => {
    expect(issueReturn('s2', paper).href).toBe('/news/all');
    expect(issueReturn('s1', null).href).toBe('/news/all');
  });
});

describe('issueHref', () => {
  it('is the bare address with pictures on and nothing else chosen', () => {
    expect(issueHref('i1', { original: false, pictures: true, from: null })).toBe('/news/i/i1');
  });

  it('keeps every choice it is given', () => {
    expect(issueHref('i1', { original: true, pictures: false, from: 's1' })).toBe(
      '/news/i/i1?view=original&pictures=0&from=s1',
    );
    expect(issueHref('i1', { original: false, pictures: false, from: null })).toBe(
      '/news/i/i1?pictures=0',
    );
  });
});

describe('unreadTopics', () => {
  const tagged = (...topics: string[]) =>
    topics.map((topic, i) => ({ headline: `h${i}`, summary: 's', topic }));

  it('lists the topics of unread newsletters in the fixed order, once each', () => {
    const unread = [
      { senderId: 's1', stories: tagged('Technology', 'Politics') },
      { senderId: 's1', stories: tagged('Politics', 'not a topic') },
    ];
    expect(unreadTopics(unread, [paper, weekly], null)).toEqual(['Politics', 'Technology']);
  });

  it('leaves out muted senders unless one is picked, and other senders when one is', () => {
    const unread = [
      { senderId: 's1', stories: tagged('Sport') },
      { senderId: 's2', stories: tagged('Health') },
    ];
    expect(unreadTopics(unread, [paper, weekly], null)).toEqual(['Sport']);
    expect(unreadTopics(unread, [paper, weekly], 's2')).toEqual(['Health']);
  });

  it('offers nothing when nothing unread carries a topic', () => {
    expect(unreadTopics([{ senderId: 's1', stories: [] }], [paper], null)).toEqual([]);
  });
});

describe('listHref', () => {
  it('keeps each filter the link does not change', () => {
    expect(listHref({ from: null, topic: null })).toBe('/news/all');
    expect(listHref({ from: 's1', topic: null })).toBe('/news/all?from=s1');
    expect(listHref({ from: 's1', topic: 'Business' })).toBe('/news/all?from=s1&topic=Business');
  });
});

describe('the by-newsletter view (note 20a58f93)', () => {
  it('groups issues by sender, most recent sender first, counting unread', () => {
    const rows = newsletterRows(
      [
        issue('a', 's1', { receivedAt: '2026-05-01T09:00:00Z', readAt: '2026-05-01T10:00:00Z' }),
        issue('b', 's2', { receivedAt: '2026-05-03T09:00:00Z' }),
        issue('c', 's1', { receivedAt: '2026-05-02T09:00:00Z' }),
      ],
      [paper, weekly],
    );
    expect(rows.map((row) => [row.sender.id, row.editions, row.unread, row.latest.id])).toEqual([
      ['s2', 1, 1, 'b'],
      ['s1', 2, 1, 'c'],
    ]);
  });

  it('reads the view from the URL and writes it back', () => {
    expect(readListView('newsletters')).toBe('newsletters');
    expect(readListView(undefined)).toBe('latest');
    expect(readListView('cards')).toBe('latest');
    expect(readListView('recommended')).toBe('recommended');
    expect(listHref({ from: null, topic: null, view: 'recommended' })).toBe('/news/all?view=recommended');
    expect(listHref({ from: null, topic: null, view: 'newsletters' })).toBe('/news/all?view=newsletters');
    expect(listHref({ from: 's1', topic: null, view: 'latest' })).toBe('/news/all?from=s1');
  });
});
