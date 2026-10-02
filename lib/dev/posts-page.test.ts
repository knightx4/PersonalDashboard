import { describe, expect, it } from 'vitest';
import { cleanThread, parsePostedUrl, postImageSrc, socialPostFromRow, threadCopyText } from './posts';
import { buildPostsPage } from './posts-page';

/** The helpers the Posts tab writes through, and the page it draws (plan #1419). */

describe('cleanThread', () => {
  it('trims each post and leaves out emptied ones', () => {
    expect(cleanThread(['  one ', '', 'two\n'])).toEqual(['one', 'two']);
  });

  it('refuses a thread with nothing left, or more than five posts', () => {
    expect(cleanThread(['', '  '])).toBeNull();
    expect(cleanThread(['1', '2', '3', '4', '5', '6'])).toBeNull();
  });
});

describe('threadCopyText', () => {
  it('puts a blank line between posts', () => {
    expect(threadCopyText(['one', 'two'])).toBe('one\n\ntwo');
  });
});

describe('parsePostedUrl', () => {
  it('takes an https link, and a bare one as https', () => {
    expect(parsePostedUrl(' https://x.com/me/status/1 ')).toEqual({
      ok: true,
      url: 'https://x.com/me/status/1',
    });
    expect(parsePostedUrl('x.com/me/status/1')).toEqual({ ok: true, url: 'https://x.com/me/status/1' });
  });

  it('refuses nothing, http and words', () => {
    expect(parsePostedUrl('').ok).toBe(false);
    expect(parsePostedUrl('http://x.com/me/status/1').ok).toBe(false);
    expect(parsePostedUrl('not a link').ok).toBe(false);
  });
});

describe('postImageSrc', () => {
  it('draws a full https link or a path on this site, and nothing else', () => {
    expect(postImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(postImageSrc('/posts/a.png')).toBe('/posts/a.png');
    expect(postImageSrc('posts/a.png')).toBeNull();
    expect(postImageSrc('//evil.example/a.png')).toBeNull();
  });
});

describe('buildPostsPage', () => {
  const row = (id: string, status: string, extra: Record<string, unknown> = {}) =>
    socialPostFromRow({
      id,
      platform: 'x',
      angle: `angle ${id}`,
      status,
      draft: ['d'],
      body: ['b'],
      source_plan_item_ids: ['s2', 's1', 'gone'],
      source_feedback_ids: ['n1'],
      image_paths: ['https://example.com/shot.png', 'bucket/shot.png'],
      created_at: '2026-10-01T09:00:00Z',
      ...extra,
    });

  it('splits by status and links the steps in number order, leaving out a deleted one', () => {
    const page = buildPostsPage({
      posts: [
        row('a', 'suggested'),
        row('b', 'posted', { posted_at: '2026-10-02T09:00:00Z', posted_url: 'https://x.com/1' }),
        row('c', 'dropped', { dropped_at: '2026-10-02T09:00:00Z' }),
      ],
      steps: [
        { id: 's1', number: 1415, title: 'Store post drafts' },
        { id: 's2', number: 1417, title: 'Teach a run' },
      ],
      notes: [{ id: 'n1', body: '\nThe posts page is slow\nmore' }],
      run: null,
      now: Date.parse('2026-10-02T12:00:00Z'),
    });

    expect(page.suggested.map((card) => card.post.id)).toEqual(['a']);
    expect(page.posted.map((card) => card.post.id)).toEqual(['b']);
    expect(page.dropped.map((card) => card.post.id)).toEqual(['c']);
    expect(page.runState).toBe('idle');

    const card = page.suggested[0]!;
    expect(card.sources.map((source) => source.label)).toEqual(['#1415', '#1417', 'a note']);
    expect(card.sources[2]).toMatchObject({ title: 'The posts page is slow', href: '/dev/bugs#note-n1' });
    expect(card.images).toEqual(['https://example.com/shot.png']);
    expect(card.day).toBe('1 Oct');
    expect(page.posted[0]!.day).toBe('2 Oct');
  });
});
