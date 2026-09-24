import { describe, expect, it } from 'vitest';
import type { NewsSender } from '@/lib/news/issues/list';
import {
  issueFinished,
  nextCard,
  quickHref,
  quickPage,
  quickTopics,
  type QuickIssue,
  type StoryPass,
} from '@/lib/news/quick/next';

const paper: NewsSender = {
  id: 's1',
  email: 'hello@thepaper.com',
  name: 'The Paper',
  muted: false,
};
const weekly: NewsSender = { id: 's2', email: 'wk@weekly.com', name: null, muted: false };
const muted: NewsSender = { id: 's3', email: 'old@digest.com', name: 'Old Digest', muted: true };
const senders = [paper, weekly, muted];

function story(headline: string) {
  return { headline, summary: `${headline} happened.` };
}

function issue(
  id: string,
  senderId: string,
  receivedAt: string,
  over: Partial<QuickIssue> = {},
): QuickIssue {
  return {
    id,
    senderId,
    subject: `Issue ${id}`,
    receivedAt,
    summary: 'A summary.',
    stories: [story(`${id}-0`), story(`${id}-1`)],
    ...over,
  };
}

const older = issue('old', 's1', '2026-09-20T08:00:00Z');
const newer = issue('new', 's2', '2026-09-22T08:00:00Z');

function headline(passes: StoryPass[], issues: QuickIssue[] = [older, newer]): string | null {
  const card = nextCard(issues, senders, passes);
  if (!card) return null;
  return card.kind === 'story' ? card.story.headline : `essay:${card.issueId}`;
}

describe('nextCard', () => {
  it('starts on the newest newsletter, at the story the email gave first', () => {
    const card = nextCard([older, newer], senders, []);
    expect(card).toMatchObject({
      kind: 'story',
      issueId: 'new',
      storyIndex: 0,
      from: 'wk@weekly.com',
      remainingInIssue: 2,
    });
  });

  it('finishes one newsletter before moving to the next older one', () => {
    expect(headline([{ issueId: 'new', storyIndex: 0 }])).toBe('new-1');
    expect(
      headline([
        { issueId: 'new', storyIndex: 0 },
        { issueId: 'new', storyIndex: 1 },
      ]),
    ).toBe('old-0');
  });

  it('skips a passed story even when an earlier one is still to come', () => {
    expect(headline([{ issueId: 'new', storyIndex: 1 }])).toBe('new-0');
    expect(nextCard([newer], senders, [{ issueId: 'new', storyIndex: 1 }])?.remainingInIssue).toBe(
      1,
    );
  });

  it('never shows a muted sender, however new', () => {
    const loud = issue('loud', 's3', '2026-09-23T08:00:00Z');
    expect(headline([], [older, loud])).toBe('old-0');
    expect(headline([], [loud])).toBeNull();
  });

  it('shows a newsletter with no stories as one card carrying its summary', () => {
    const essay = issue('essay', 's1', '2026-09-23T08:00:00Z', {
      stories: [],
      summary: 'One long argument.',
    });
    expect(nextCard([older, essay], senders, [])).toMatchObject({
      kind: 'essay',
      summary: 'One long argument.',
      issueId: 'essay',
      storyIndex: 0,
      remainingInIssue: 1,
    });
    expect(headline([{ issueId: 'essay', storyIndex: 0 }], [older, essay])).toBe('old-0');
  });

  it('leaves out a newsletter that has not been summarised', () => {
    const pending = issue('pending', 's1', '2026-09-23T08:00:00Z', {
      summary: null,
      stories: null,
    });
    expect(headline([], [older, pending])).toBe('old-0');
  });

  it('keeps each story at its stored position when an earlier entry is malformed', () => {
    const broken = issue('broken', 's1', '2026-09-23T08:00:00Z', {
      stories: [{ headline: '' }, story('kept')],
    });
    expect(nextCard([broken], senders, [])).toMatchObject({ storyIndex: 1, remainingInIssue: 1 });
    expect(nextCard([broken], senders, [{ issueId: 'broken', storyIndex: 1 }])).toBeNull();
  });

  it('returns nothing when every story has been passed', () => {
    const all: StoryPass[] = [0, 1].flatMap((storyIndex) => [
      { issueId: 'new', storyIndex },
      { issueId: 'old', storyIndex },
    ]);
    expect(nextCard([older, newer], senders, all)).toBeNull();
  });

  it('returns nothing when there are no newsletters', () => {
    expect(nextCard([], senders, [])).toBeNull();
  });
});

describe('issueFinished', () => {
  it('is true once every story has been passed', () => {
    expect(issueFinished(older, [{ issueId: 'old', storyIndex: 0 }])).toBe(false);
    expect(
      issueFinished(older, [
        { issueId: 'old', storyIndex: 0 },
        { issueId: 'old', storyIndex: 1 },
      ]),
    ).toBe(true);
  });

  it('ignores passes on other newsletters', () => {
    expect(
      issueFinished(older, [
        { issueId: 'new', storyIndex: 0 },
        { issueId: 'new', storyIndex: 1 },
      ]),
    ).toBe(false);
  });

  it('treats an essay as finished after its one card', () => {
    const essay = issue('essay', 's1', '2026-09-23T08:00:00Z', { stories: [] });
    expect(issueFinished(essay, [{ issueId: 'essay', storyIndex: 0 }])).toBe(true);
  });

  it('never finishes a newsletter that has not been summarised', () => {
    const pending = issue('pending', 's1', '2026-09-23T08:00:00Z', {
      summary: null,
      stories: null,
    });
    expect(issueFinished(pending, [{ issueId: 'pending', storyIndex: 0 }])).toBe(false);
  });
});

describe('the topic filter', () => {
  const tagged = (headline: string, topic: string) => ({ ...story(headline), topic });
  const mixed = issue('mix', 's1', '2026-09-22T09:00:00Z', {
    stories: [tagged('mix-0', 'Politics'), tagged('mix-1', 'Sport'), tagged('mix-2', 'Politics')],
  });
  const sport = issue('sport', 's2', '2026-09-21T09:00:00Z', {
    stories: [tagged('sport-0', 'Sport')],
  });
  const hidden = issue('hush', 's3', '2026-09-23T09:00:00Z', {
    stories: [tagged('hush-0', 'Health')],
  });
  const essay = issue('essay', 's1', '2026-09-23T10:00:00Z', { stories: [] });
  const all = [mixed, sport, hidden, essay];

  it('shows only stories on the topic, across newsletters, and counts only those', () => {
    const first = nextCard(all, senders, [], { topic: 'Sport' });
    expect(first).toMatchObject({ issueId: 'mix', storyIndex: 1, remainingInIssue: 1 });
    const second = nextCard(all, senders, [{ issueId: 'mix', storyIndex: 1 }], { topic: 'Sport' });
    expect(second).toMatchObject({ issueId: 'sport', storyIndex: 0 });
    expect(
      nextCard(all, senders, [{ issueId: 'mix', storyIndex: 0 }], { topic: 'Politics' }),
    ).toMatchObject({ storyIndex: 2, remainingInIssue: 1 });
  });

  it('shows everything, essays included, with no topic', () => {
    expect(nextCard(all, senders, [], { topic: null })).toMatchObject({ kind: 'essay' });
    expect(nextCard(all, senders, [])).toMatchObject({ kind: 'essay' });
  });

  it('is caught up once nothing on the topic is left', () => {
    expect(
      nextCard(all, senders, [{ issueId: 'sport', storyIndex: 0 }], { topic: 'Health' }),
    ).toBeNull();
    const passes = [
      { issueId: 'mix', storyIndex: 1 },
      { issueId: 'sport', storyIndex: 0 },
    ];
    expect(nextCard(all, senders, passes, { topic: 'Sport' })).toBeNull();
  });

  it('offers a chip only for topics with a story left, muted senders aside', () => {
    expect(quickTopics(all, senders, [])).toEqual(['Politics', 'Sport']);
    const passes = [
      { issueId: 'mix', storyIndex: 1 },
      { issueId: 'sport', storyIndex: 0 },
    ];
    expect(quickTopics(all, senders, passes)).toEqual(['Politics']);
  });

  it('leaves out a hidden topic but keeps essays and the other topics', () => {
    const hide = { hidden: ['Politics'] as const };
    expect(nextCard(all, senders, [], hide)).toMatchObject({ kind: 'essay' });
    const afterEssay = [{ issueId: 'essay', storyIndex: 0 }];
    expect(nextCard(all, senders, afterEssay, hide)).toMatchObject({
      issueId: 'mix',
      storyIndex: 1,
      remainingInIssue: 1,
    });
    const allSport = [
      ...afterEssay,
      { issueId: 'mix', storyIndex: 1 },
      { issueId: 'sport', storyIndex: 0 },
    ];
    expect(nextCard(all, senders, allSport, hide)).toBeNull();
    expect(nextCard(all, senders, [], { topic: 'Politics', hidden: ['Politics'] })).toBeNull();
  });

  it('offers no chip for a hidden topic', () => {
    expect(quickTopics(all, senders, [], ['Politics'])).toEqual(['Sport']);
  });

  it('keeps the pictures setting and the topic on the address', () => {
    expect(quickHref({ pictures: true, topic: null })).toBe('/news');
    expect(quickHref({ pictures: false, topic: 'Sport' })).toBe('/news?pictures=0&topic=Sport');
  });
});

describe('quickPage', () => {
  const pictured = (headline: string) => ({
    ...story(headline),
    image: `https://img.example/${headline}.jpg`,
  });
  const key = (card: { issueId: string; storyIndex: number }) =>
    `${card.issueId}:${card.storyIndex}`;

  /** What nextCard shows one card at a time, passing each before asking again. */
  function oneByOne(
    issues: QuickIssue[],
    passes: StoryPass[],
    filter: Parameters<typeof quickPage>[3] = {},
  ): string[] {
    const seen = [...passes];
    const found: string[] = [];
    for (let card = nextCard(issues, senders, seen, filter); card; ) {
      found.push(key(card));
      seen.push({ issueId: card.issueId, storyIndex: card.storyIndex });
      card = nextCard(issues, senders, seen, filter);
    }
    return found;
  }

  const a = issue('a', 's1', '2026-09-23T08:00:00Z', {
    stories: [story('a-0'), story('a-1'), story('a-2')],
  });
  const b = issue('b', 's2', '2026-09-22T08:00:00Z', {
    stories: [story('b-0'), story('b-1'), story('b-2'), story('b-3')],
  });
  const quiet = issue('quiet', 's3', '2026-09-24T08:00:00Z');

  it('holds the first six cards nextCard would show, in its order, when none has a picture', () => {
    const page = quickPage([b, a, quiet], senders, []);
    expect(page.map(key)).toEqual(oneByOne([b, a, quiet], []).slice(0, 6));
    expect(page.map(key)).toEqual(['a:0', 'a:1', 'a:2', 'b:0', 'b:1', 'b:2']);
    expect(page.map((card) => card.remainingInIssue)).toEqual([3, 2, 1, 4, 3, 2]);
  });

  it('moves the first story with a picture to the front and keeps the rest in order', () => {
    const shown = issue('shown', 's1', '2026-09-23T08:00:00Z', {
      stories: [story('s-0'), story('s-1'), pictured('s-2'), pictured('s-3')],
    });
    const page = quickPage([shown], senders, []);
    expect(page.map(key)).toEqual(['shown:2', 'shown:0', 'shown:1', 'shown:3']);
  });

  it('leaves a page alone when its first card already has a picture', () => {
    const first = issue('first', 's1', '2026-09-23T08:00:00Z', {
      stories: [pictured('f-0'), story('f-1'), pictured('f-2')],
    });
    expect(quickPage([first], senders, []).map(key)).toEqual(['first:0', 'first:1', 'first:2']);
  });

  it('only leads with a picture from the page itself, not from a later page', () => {
    const late = issue('late', 's2', '2026-09-20T08:00:00Z', { stories: [pictured('late-0')] });
    const page = quickPage([a, b, late], senders, []);
    expect(page.map(key)).toEqual(['a:0', 'a:1', 'a:2', 'b:0', 'b:1', 'b:2']);
  });

  it('never shows a passed, muted or hidden story, and is shorter when fewer are left', () => {
    const tagged = issue('tag', 's1', '2026-09-23T08:00:00Z', {
      stories: [
        { ...story('t-0'), topic: 'Sport' },
        { ...story('t-1'), topic: 'Politics' },
        { ...story('t-2'), topic: 'Sport' },
      ],
    });
    const passes = [{ issueId: 'tag', storyIndex: 2 }];
    const hide = { hidden: ['Sport'] as const };
    const page = quickPage([tagged, quiet, older], senders, passes, hide);
    expect(page.map(key)).toEqual(oneByOne([tagged, quiet, older], passes, hide));
    expect(page.map(key)).toEqual(['tag:1', 'old:0', 'old:1']);
  });

  it('keeps to the picked topic', () => {
    const tagged = issue('tag', 's1', '2026-09-23T08:00:00Z', {
      stories: [
        { ...story('t-0'), topic: 'Sport' },
        { ...pictured('t-1'), topic: 'Politics' },
        { ...story('t-2'), topic: 'Sport' },
      ],
    });
    expect(quickPage([tagged], senders, [], { topic: 'Sport' }).map(key)).toEqual([
      'tag:0',
      'tag:2',
    ]);
  });

  it('is empty when you are caught up', () => {
    const passes = [
      { issueId: 'old', storyIndex: 0 },
      { issueId: 'old', storyIndex: 1 },
    ];
    expect(quickPage([older], senders, passes)).toEqual([]);
    expect(quickPage([], senders, [])).toEqual([]);
  });
});
