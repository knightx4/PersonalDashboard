import { describe, expect, it } from 'vitest';
import {
  MATCH_CLOSE,
  MATCH_NEAR,
  normalizePostText,
  planMatches,
  postSimilarity,
  xPostIdFromUrl,
  type MatchDraft,
  type MatchPost,
} from './match';

const DRAFT =
  'Every button in my app that calls a model shows what one press costs, from what that press cost before. A test walks every server action and fails the merge when one reaches a model with no hint beside its button.';

/** Edits a person makes between copying a draft and posting it, which should still match outright. */
const CLOSE_EDITS: Record<string, string> = {
  'as drafted': DRAFT,
  'whitespace and line breaks': DRAFT.replace('. A test', '.\n\nA  test'),
  'case': DRAFT.replace('Every button', 'EVERY button'),
  'curly quotes and an entity': DRAFT.replace('my app', '“my app”').replace(' and fails', ' &amp; fails'),
  'a link added, shortened by X': `${DRAFT} https://t.co/AbC123xyz`,
  'a typo fixed': DRAFT.replace('beside its button', 'besides its button'),
  'an emoji added': `${DRAFT} 💸`,
  'a word swapped': DRAFT.replace('fails the merge', 'blocks the merge'),
};

/** Heavier rewrites: probably the draft, so the person is asked. */
const NEAR_EDITS: Record<string, string> = {
  'a sentence reworded':
    'Every button in my app that calls a model now shows what one press costs, based on what it cost before. A test walks each server action and fails the merge if one reaches a model with no hint by its button.',
  'the second sentence cut and one added':
    'Every button in my app that calls a model shows what one press costs, from what that press cost before. Took a weekend, and it already stopped two surprises on the bill.',
  'cut to its first sentence': 'Every button in my app that calls a model shows what one press costs.',
};

/** Different posts that must never match. */
const NO_MATCH: Record<string, string> = {
  'another post on the same subject':
    'Model costs were creeping up, so I started logging every call. Here is what a week of it looked like.',
  'a short post': 'Shipped.',
  'a short post found inside it': 'every button',
};

function draft(over: Partial<MatchDraft> = {}): MatchDraft {
  return {
    id: 'd1',
    status: 'suggested',
    firstPost: DRAFT,
    firstDraft: DRAFT,
    createdAt: '2026-10-01T09:00:00Z',
    postedUrl: null,
    xPostId: null,
    xCandidateId: null,
    xDismissedIds: [],
    ...over,
  };
}

function post(id: string, text: string, createdAt = '2026-10-02T09:00:00Z'): MatchPost {
  return { xPostId: id, text, createdAt, url: `https://x.com/me/status/${id}` };
}

describe('normalizePostText', () => {
  it('drops links, folds case and quotes, decodes entities and collapses whitespace', () => {
    expect(normalizePostText('Read  “THIS”\n&amp; https://t.co/xyz now…')).toBe('read "this" & now...');
  });
});

describe('postSimilarity on edited drafts', () => {
  for (const [name, text] of Object.entries(CLOSE_EDITS)) {
    it(`matches outright: ${name}`, () => {
      expect(postSimilarity(DRAFT, text)).toBeGreaterThanOrEqual(MATCH_CLOSE);
    });
  }
  for (const [name, text] of Object.entries(NEAR_EDITS)) {
    it(`asks: ${name}`, () => {
      const score = postSimilarity(DRAFT, text);
      expect(score).toBeGreaterThanOrEqual(MATCH_NEAR);
      expect(score).toBeLessThan(MATCH_CLOSE);
    });
  }
  for (const [name, text] of Object.entries(NO_MATCH)) {
    it(`does not match: ${name}`, () => {
      expect(postSimilarity(DRAFT, text)).toBeLessThan(MATCH_NEAR);
    });
  }
});

describe('planMatches', () => {
  it('marks a close match posted and asks about a near one', () => {
    const plan = planMatches({
      drafts: [draft(), draft({ id: 'd2', firstPost: 'A different draft about the plan page and its visions.', firstDraft: null })],
      posts: [post('10', CLOSE_EDITS['a typo fixed']), post('11', 'A different draft about the plan pages and the visions on them!')],
    });
    expect(plan.posted.map((p) => [p.draftId, p.post.xPostId])).toEqual([['d1', '10']]);
    expect(plan.candidates).toEqual([{ draftId: 'd2', xPostId: '11' }]);
  });

  it('matches a dropped draft too', () => {
    const plan = planMatches({ drafts: [draft({ status: 'dropped' })], posts: [post('10', DRAFT)] });
    expect(plan.posted).toHaveLength(1);
  });

  it('gives each post to one draft and each draft one post, best first', () => {
    const plan = planMatches({
      drafts: [draft({ id: 'a', firstPost: CLOSE_EDITS['a word swapped'], firstDraft: null }), draft({ id: 'b' })],
      posts: [post('10', DRAFT), post('11', DRAFT, '2026-10-03T09:00:00Z')],
    });
    expect(plan.posted.map((p) => [p.draftId, p.post.xPostId]).sort()).toEqual([
      ['a', '11'],
      ['b', '10'],
    ]);
  });

  it('compares the text Dash first wrote as well as the edited one', () => {
    const plan = planMatches({
      drafts: [draft({ firstPost: 'Totally rewritten in the tab, nothing like it.' })],
      posts: [post('10', DRAFT)],
    });
    expect(plan.posted).toHaveLength(1);
  });

  it('never touches a draft with a link pasted by hand, and links its post', () => {
    const plan = planMatches({
      drafts: [draft({ status: 'posted', postedUrl: 'https://x.com/me/status/10?s=20' })],
      posts: [post('10', DRAFT)],
    });
    expect(plan.posted).toEqual([]);
    expect(plan.candidates).toEqual([]);
    expect(plan.linked).toEqual([{ draftId: 'd1', xPostId: '10' }]);
  });

  it('does not offer a post the person said was not it, and clears a stale question', () => {
    const plan = planMatches({
      drafts: [draft({ xCandidateId: '11', xDismissedIds: ['11'] })],
      posts: [post('11', NEAR_EDITS['a sentence reworded'])],
    });
    expect(plan.candidates).toEqual([{ draftId: 'd1', xPostId: null }]);
  });

  it('leaves an unchanged question alone', () => {
    const plan = planMatches({
      drafts: [draft({ xCandidateId: '11' })],
      posts: [post('11', NEAR_EDITS['a sentence reworded'])],
    });
    expect(plan.candidates).toEqual([]);
  });

  it('skips posts from well before the draft was written, and posts already matched', () => {
    const plan = planMatches({
      drafts: [draft(), draft({ id: 'd0', status: 'posted', postedUrl: 'https://x.com/me/status/12', xPostId: '12' })],
      posts: [post('10', DRAFT, '2026-09-01T09:00:00Z'), post('12', DRAFT)],
    });
    expect(plan.posted).toEqual([]);
  });
});

describe('xPostIdFromUrl', () => {
  it('reads the id from a post link', () => {
    expect(xPostIdFromUrl('https://x.com/me/status/1845?s=46')).toBe('1845');
    expect(xPostIdFromUrl('https://twitter.com/me/statuses/77')).toBe('77');
    expect(xPostIdFromUrl('https://example.com/post')).toBeNull();
  });
});
