import { describe, expect, it } from 'vitest';
import type { NewsSender } from '@/lib/news/issues/list';
import { cardPasses, nextCard, quickPage, quickTopics, type QuickIssue } from './next';
import {
  COVERAGE_CAP,
  INTEREST_CAP,
  interestModel,
  rankReason,
  storyScore,
  type InterestRow,
} from './rank';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('storyScore', () => {
  const base = { newsletters: 1, lead: false, topicLean: 0, senderLean: 0 };

  it('halves a story each day', () => {
    expect(storyScore({ ...base, receivedAt: hoursAgo(0) }, NOW)).toBeCloseTo(1);
    expect(storyScore({ ...base, receivedAt: hoursAgo(24) }, NOW)).toBeCloseTo(0.5);
  });

  it('puts an event five newsletters ran from yesterday above a lone story from now', () => {
    const big = storyScore({ ...base, receivedAt: hoursAgo(24), newsletters: 5 }, NOW);
    const lone = storyScore({ ...base, receivedAt: hoursAgo(0) }, NOW);
    expect(big).toBeGreaterThan(lone);
  });

  it('caps what coverage adds', () => {
    const ten = storyScore({ ...base, receivedAt: hoursAgo(1000), newsletters: 10 }, NOW);
    expect(ten).toBeCloseTo(COVERAGE_CAP, 3);
  });

  it('scores a story with no readable arrival as old', () => {
    expect(storyScore({ ...base, receivedAt: 'not a date' }, NOW)).toBe(0);
  });
});

describe('interestModel', () => {
  const row = (topic: string, seen: number, opened: number, senderId = 's1'): InterestRow => ({
    senderId,
    topic,
    seen,
    opened,
    saved: 0,
  });

  it('leans nowhere until a few stories have been opened or saved', () => {
    const model = interestModel([row('Technology', 10, 2), row('Politics', 30, 0)]);
    expect(model.topic('Technology')).toBe(0);
    expect(model.topic('Politics')).toBe(0);
  });

  it('leans towards topics you open and, more gently, away from ones you pass', () => {
    const model = interestModel([row('Technology', 20, 8), row('Politics', 60, 1)]);
    const up = model.topic('Technology');
    const down = model.topic('Politics');
    expect(up).toBeGreaterThan(0.15);
    expect(down).toBeLessThan(0);
    expect(Math.abs(down)).toBeLessThan(up);
    expect(up).toBeLessThanOrEqual(INTEREST_CAP);
  });

  it('counts a save for more than an open', () => {
    const opened = interestModel([
      { senderId: 's1', topic: 'Science', seen: 10, opened: 2, saved: 0 },
      row('Politics', 40, 2),
    ]);
    const saved = interestModel([
      { senderId: 's1', topic: 'Science', seen: 10, opened: 0, saved: 2 },
      row('Politics', 40, 2),
    ]);
    expect(saved.topic('Science')).toBeGreaterThan(opened.topic('Science'));
  });

  it('leans by newsletter as well as topic, and not at all for one it has never seen', () => {
    const model = interestModel([row('Politics', 20, 8, 'keen'), row('Politics', 40, 0, 'dull')]);
    expect(model.sender('keen')).toBeGreaterThan(0);
    expect(model.sender('dull')).toBeLessThan(0);
    expect(model.sender('new')).toBe(0);
  });
});

describe('rankReason', () => {
  const quiet = { topic: undefined, topicLean: 0, from: 'NPR', senderLean: 0 };
  it('names coverage by three or more newsletters first', () => {
    expect(rankReason({ ...quiet, newsletters: 3, topic: 'Politics', topicLean: 0.4 })).toBe(
      'Ran in 3 of your newsletters',
    );
  });
  it('then a topic you open, then a newsletter you open', () => {
    expect(rankReason({ ...quiet, newsletters: 2, topic: 'Science', topicLean: 0.2 })).toBe(
      'You often open Science stories',
    );
    expect(rankReason({ ...quiet, newsletters: 1, senderLean: 0.2 })).toBe('You often open NPR');
  });
  it('says nothing when nothing stands out', () => {
    expect(rankReason({ ...quiet, newsletters: 2 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ranked Quick read
// ---------------------------------------------------------------------------

const senders: NewsSender[] = [
  { id: 'axios', email: 'pm@axios.com', name: 'Axios PM', muted: false },
  { id: 'npr', email: 'news@npr.org', name: 'NPR', muted: false },
  { id: 'brew', email: 'crew@brew.com', name: 'Morning Brew', muted: false },
  { id: 'old', email: 'x@old.com', name: 'Old', muted: true },
];

function issue(id: string, senderId: string, hours: number, stories: object[]): QuickIssue {
  return { id, senderId, subject: id, receivedAt: hoursAgo(hours), summary: 'S.', stories };
}
const s = (headline: string, over: object = {}) => ({ headline, summary: `${headline}.`, ...over });

// The press-pass ruling ran in all three. Axios is newest, so #846's order
// would open on its lead story, a lone one.
const axios = issue('ax', 'axios', 1, [
  s('Lone scoop'),
  s('Press passes back', { link: 'https://a' }),
]);
const npr = issue('np', 'npr', 5, [
  s('Judge restores press passes', { link: 'https://n', image: 'https://n.png' }),
  s('Science thing', { topic: 'Science' }),
]);
const brew = issue('br', 'brew', 9, [s('Reporters regain access'), s('Markets')]);
const issues = [axios, npr, brew];
const groups = [
  { issueId: 'ax', storyIndex: 1, groupId: 'g' },
  { issueId: 'np', storyIndex: 0, groupId: 'g' },
  { issueId: 'br', storyIndex: 0, groupId: 'g' },
];
const signals = { groups, interest: [], now: NOW };

describe('nextCard with signals', () => {
  it('shows an event three newsletters ran once, first, from its fullest telling', () => {
    const card = nextCard(issues, senders, [], {}, signals);
    expect(card).toMatchObject({ issueId: 'np', storyIndex: 0, from: 'NPR' });
    expect(card?.alsoIn.map((a) => a.from)).toEqual(['Axios PM', 'Morning Brew']);
    expect(card?.reason).toBe('Ran in 3 of your newsletters');
    expect(card?.repeats).toEqual([
      { issueId: 'ax', storyIndex: 1 },
      { issueId: 'br', storyIndex: 0 },
    ]);
  });

  it('never shows the event again once any telling of it is passed', () => {
    const passes = [{ issueId: 'br', storyIndex: 0 }];
    const page = quickPage(issues, senders, passes, {}, 10, signals);
    const headlines = page.map((c) => (c.kind === 'story' ? c.story.headline : ''));
    expect(headlines).not.toContain('Judge restores press passes');
    expect(headlines).not.toContain('Press passes back');
    expect(headlines).toEqual(['Lone scoop', 'Science thing', 'Markets']);
  });

  it('pages through every other story once, with the event only at the top', () => {
    const page = quickPage(issues, senders, [], {}, 10, signals);
    expect(page.map((c) => `${c.issueId}:${c.storyIndex}`)).toEqual([
      'np:0',
      'ax:0',
      'np:1',
      'br:1',
    ]);
  });

  it('lifts a topic you open over a fresher one you do not', () => {
    const interest: InterestRow[] = [
      { senderId: 'npr', topic: 'Science', seen: 10, opened: 8, saved: 0 },
      { senderId: 'axios', topic: 'Politics', seen: 40, opened: 0, saved: 0 },
    ];
    const passes = cardPasses(nextCard(issues, senders, [], {}, signals)!);
    const card = nextCard(issues, senders, passes, {}, { ...signals, interest });
    expect(card?.kind === 'story' && card.story.headline).toBe('Science thing');
    expect(card?.reason).toBe('You often open Science stories');
  });

  it('keeps a topic chip only while a story on it is left, repeats included', () => {
    expect(quickTopics(issues, senders, [], [], groups)).toEqual(['Science']);
    expect(quickTopics(issues, senders, [{ issueId: 'np', storyIndex: 1 }], [], groups)).toEqual(
      [],
    );
  });

  it('matches a group to the readable story, past a malformed entry', () => {
    const odd = issue('od', 'brew', 2, [{ headline: '' }, s('Press again')]);
    const card = nextCard(
      [odd, npr],
      senders,
      [],
      {},
      {
        groups: [
          { issueId: 'od', storyIndex: 0, groupId: 'g' },
          { issueId: 'np', storyIndex: 0, groupId: 'g' },
        ],
        now: NOW,
      },
    );
    expect(card?.repeats).toEqual([{ issueId: 'od', storyIndex: 1 }]);
  });
});
