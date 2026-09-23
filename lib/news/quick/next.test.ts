import { describe, expect, it } from 'vitest';
import type { NewsSender } from '@/lib/news/issues/list';
import { issueFinished, nextCard, type QuickIssue, type StoryPass } from '@/lib/news/quick/next';

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
