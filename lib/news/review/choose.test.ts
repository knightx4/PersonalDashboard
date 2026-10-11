import { describe, expect, it } from 'vitest';
import type { NewsSender } from '@/lib/news/issues/list';
import type { QuickIssue, StoryGroupRow } from '@/lib/news/quick/next';
import {
  chooseReviewStories,
  reviewItem,
  REVIEW_MAX_STORIES,
  type ReviewInput,
} from '@/lib/news/review/choose';

const paper: NewsSender = { id: 's1', email: 'p@paper.com', name: 'The Paper', muted: false };
const weekly: NewsSender = { id: 's2', email: 'w@weekly.com', name: 'Weekly', muted: false };
const muted: NewsSender = { id: 's3', email: 'o@old.com', name: 'Old Digest', muted: true };

const until = new Date('2026-10-06T19:00:00Z');

type StoryIn = { headline: string; rating?: number; topic?: string; link?: string };

function story({ headline, rating, topic, link }: StoryIn) {
  return { headline, summary: `${headline} happened.`, rating, topic, link };
}

function issue(
  id: string,
  senderId: string,
  receivedAt: string,
  stories: unknown[],
  summary: string | null = 'A summary.',
): QuickIssue {
  return { id, senderId, subject: `Issue ${id}`, receivedAt, summary, stories };
}

function input(over: Partial<ReviewInput>): ReviewInput {
  return {
    issues: [],
    senders: [paper, weekly, muted],
    groups: [],
    hidden: [],
    until,
    ...over,
  };
}

const headlines = (over: Partial<ReviewInput>) =>
  chooseReviewStories(input(over)).map((p) => p.headline);

describe('chooseReviewStories', () => {
  it('gives nothing on a day with no newsletters', () => {
    expect(chooseReviewStories(input({}))).toEqual([]);
  });

  it('ranks by rating, highest first, with unrated stories last', () => {
    const issues = [
      issue('a', 's1', '2026-10-06T08:00:00Z', [
        story({ headline: 'Low', rating: 20 }),
        story({ headline: 'Unrated' }),
        story({ headline: 'High', rating: 90 }),
      ]),
    ];
    expect(headlines({ issues })).toEqual(['High', 'Low', 'Unrated']);
  });

  it('keeps at most ten', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      story({ headline: `Story ${i}`, rating: 50 + i }),
    );
    const picks = chooseReviewStories(
      input({ issues: [issue('a', 's1', '2026-10-06T08:00:00Z', many)] }),
    );
    expect(picks).toHaveLength(REVIEW_MAX_STORIES);
    expect(picks[0].headline).toBe('Story 13');
    expect(picks.at(-1)?.headline).toBe('Story 4');
  });

  it('only takes the 24 hours before the review is written', () => {
    const issues = [
      issue('old', 's1', '2026-10-05T19:00:00Z', [
        story({ headline: 'Exactly a day ago', rating: 99 }),
      ]),
      issue('in', 's1', '2026-10-05T19:00:01Z', [story({ headline: 'Inside', rating: 10 })]),
      issue('end', 's1', '2026-10-06T19:00:00Z', [story({ headline: 'At the hour', rating: 5 })]),
      issue('late', 's1', '2026-10-06T19:00:01Z', [story({ headline: 'After', rating: 99 })]),
    ];
    expect(headlines({ issues })).toEqual(['Inside', 'At the hour']);
  });

  it('leaves out muted senders, unsummarised newsletters and essays', () => {
    const issues = [
      issue('m', 's3', '2026-10-06T08:00:00Z', [story({ headline: 'Muted', rating: 99 })]),
      issue(
        'u',
        's1',
        '2026-10-06T08:00:00Z',
        [story({ headline: 'Unsummarised', rating: 99 })],
        null,
      ),
      issue('e', 's1', '2026-10-06T08:00:00Z', []),
      issue('ok', 's2', '2026-10-06T08:00:00Z', [story({ headline: 'Kept', rating: 1 })]),
    ];
    expect(headlines({ issues })).toEqual(['Kept']);
  });

  it('leaves out stories from a hidden topic', () => {
    const issues = [
      issue('a', 's1', '2026-10-06T08:00:00Z', [
        story({ headline: 'Football', rating: 95, topic: 'Sport' }),
        story({ headline: 'Budget', rating: 60, topic: 'Politics' }),
        story({ headline: 'Untagged', rating: 40 }),
      ]),
    ];
    expect(headlines({ issues, hidden: ['Sport'] })).toEqual(['Budget', 'Untagged']);
  });

  describe('an event several newsletters ran', () => {
    const issues = [
      issue('a', 's1', '2026-10-06T10:00:00Z', [
        story({ headline: 'Rates cut (Paper)', rating: 70 }),
        story({ headline: 'Other', rating: 75 }),
      ]),
      issue('b', 's2', '2026-10-06T12:00:00Z', [
        story({ headline: 'Rates cut (Weekly)', rating: 88 }),
      ]),
    ];
    const groups: StoryGroupRow[] = [
      { issueId: 'a', storyIndex: 0, groupId: 'g1' },
      { issueId: 'b', storyIndex: 0, groupId: 'g1' },
    ];

    it('appears once, with the highest rating and the count of newsletters', () => {
      const picks = chooseReviewStories(input({ issues, groups }));
      expect(picks.map((p) => p.headline)).toEqual(['Rates cut (Weekly)', 'Other']);
      expect(picks[0]).toMatchObject({ issueId: 'b', storyIndex: 0, sources: 2, rating: 88 });
      expect(picks[1].sources).toBe(1);
    });

    it('counts one newsletter that ran it twice once', () => {
      const twice = [
        issue('a', 's1', '2026-10-06T10:00:00Z', [story({ headline: 'Morning', rating: 50 })]),
        issue('c', 's1', '2026-10-06T16:00:00Z', [story({ headline: 'Evening', rating: 40 })]),
      ];
      const picks = chooseReviewStories(
        input({
          issues: twice,
          groups: [
            { issueId: 'a', storyIndex: 0, groupId: 'g' },
            { issueId: 'c', storyIndex: 0, groupId: 'g' },
          ],
        }),
      );
      expect(picks).toHaveLength(1);
      expect(picks[0]).toMatchObject({ headline: 'Morning', sources: 1, rating: 50 });
    });

    it('keeps the event through its other tellings when one is a hidden topic', () => {
      const tagged = [
        issue('a', 's1', '2026-10-06T10:00:00Z', [
          story({ headline: 'Match report', rating: 90, topic: 'Sport' }),
        ]),
        issue('b', 's2', '2026-10-06T12:00:00Z', [
          story({ headline: 'Stadium deal', rating: 60, topic: 'Business' }),
        ]),
      ];
      const picks = chooseReviewStories(input({ issues: tagged, groups, hidden: ['Sport'] }));
      expect(picks).toEqual([
        expect.objectContaining({ headline: 'Stadium deal', rating: 60, sources: 1 }),
      ]);
    });
  });

  it('uses the stored position when a malformed story comes first', () => {
    const issues = [
      issue('a', 's1', '2026-10-06T10:00:00Z', [
        { headline: '' },
        story({ headline: 'Second', rating: 80 }),
      ]),
      issue('b', 's2', '2026-10-06T11:00:00Z', [story({ headline: 'Same', rating: 30 })]),
    ];
    // story_groups numbers among the readable stories, so Second is 0 there.
    const groups: StoryGroupRow[] = [
      { issueId: 'a', storyIndex: 0, groupId: 'g' },
      { issueId: 'b', storyIndex: 0, groupId: 'g' },
    ];
    const picks = chooseReviewStories(input({ issues, groups }));
    expect(picks).toEqual([
      expect.objectContaining({ issueId: 'a', storyIndex: 1, headline: 'Second', sources: 2 }),
    ]);
  });

  describe('ties', () => {
    it('go to the event more newsletters ran, then the newest', () => {
      const issues = [
        issue('old', 's1', '2026-10-06T08:00:00Z', [
          story({ headline: 'Older', rating: 60 }),
          story({ headline: 'Shared', rating: 60 }),
        ]),
        issue('new', 's2', '2026-10-06T15:00:00Z', [
          story({ headline: 'Newer', rating: 60 }),
          story({ headline: 'Shared too', rating: 50 }),
        ]),
      ];
      const groups: StoryGroupRow[] = [
        { issueId: 'old', storyIndex: 1, groupId: 'g' },
        { issueId: 'new', storyIndex: 1, groupId: 'g' },
      ];
      expect(headlines({ issues, groups })).toEqual(['Shared', 'Newer', 'Older']);
    });

    it('keep the email order within one newsletter', () => {
      const issues = [
        issue('a', 's1', '2026-10-06T08:00:00Z', [
          story({ headline: 'First', rating: 60 }),
          story({ headline: 'Second', rating: 60 }),
        ]),
      ];
      expect(headlines({ issues })).toEqual(['First', 'Second']);
    });

    it('open the fuller telling when two tellings are rated the same', () => {
      const issues = [
        issue('a', 's1', '2026-10-06T15:00:00Z', [story({ headline: 'Bare', rating: 70 })]),
        issue('b', 's2', '2026-10-06T08:00:00Z', [
          story({ headline: 'Linked', rating: 70, link: 'https://example.com/a' }),
        ]),
      ];
      const groups: StoryGroupRow[] = [
        { issueId: 'a', storyIndex: 0, groupId: 'g' },
        { issueId: 'b', storyIndex: 0, groupId: 'g' },
      ];
      expect(headlines({ issues, groups })).toEqual(['Linked']);
    });
  });

  describe('the Local story', () => {
    const tenNational = Array.from({ length: 10 }, (_, i) =>
      story({ headline: `National ${i}`, rating: 80 + i, topic: 'World' }),
    );

    it('is added after the ten when none made it', () => {
      const issues = [
        issue('a', 's1', '2026-10-06T08:00:00Z', [
          ...tenNational,
          story({ headline: 'Council vote', rating: 40, topic: 'Local' }),
          story({ headline: 'Bin collection', rating: 20, topic: 'Local' }),
        ]),
      ];
      const picks = chooseReviewStories(input({ issues }));
      expect(picks).toHaveLength(11);
      expect(picks.at(-1)).toMatchObject({ headline: 'Council vote', local: true });
      expect(picks.filter((p) => p.local)).toHaveLength(1);
    });

    it('is marked where it stands when it made the ten', () => {
      const issues = [
        issue('a', 's1', '2026-10-06T08:00:00Z', [
          story({ headline: 'National', rating: 90, topic: 'World' }),
          story({ headline: 'Flood warning', rating: 85, topic: 'Local' }),
          story({ headline: 'Fete', rating: 10, topic: 'Local' }),
        ]),
      ];
      const picks = chooseReviewStories(input({ issues }));
      expect(picks.map((p) => [p.headline, p.local ?? false])).toEqual([
        ['National', false],
        ['Flood warning', true],
        ['Fete', false],
      ]);
    });

    it('is not added when there is none, or Local is hidden', () => {
      const local = story({ headline: 'Council vote', rating: 40, topic: 'Local' });
      const issues = [issue('a', 's1', '2026-10-06T08:00:00Z', [...tenNational, local])];
      expect(chooseReviewStories(input({ issues, hidden: ['Local'] }))).toHaveLength(10);
      const none = [issue('a', 's1', '2026-10-06T08:00:00Z', tenNational)];
      expect(chooseReviewStories(input({ issues: none })).some((p) => p.local)).toBe(false);
    });
  });
});

describe('reviewItem', () => {
  it('is the stored item shape', () => {
    expect(
      reviewItem(
        { issueId: 'a', storyIndex: 2, headline: 'H', summary: 'S', sources: 3, rating: 9 },
        'One line.',
      ),
    ).toEqual({ issue_id: 'a', story_index: 2, headline: 'H', line: 'One line.', sources: 3 });
    expect(
      reviewItem(
        { issueId: 'a', storyIndex: 0, headline: 'H', summary: 'S', sources: 1, local: true },
        'L',
      ),
    ).toEqual({ issue_id: 'a', story_index: 0, headline: 'H', line: 'L', sources: 1, local: true });
  });
});
