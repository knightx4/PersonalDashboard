import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import { relatedNotesForStories } from './related-notes';

const ISSUE = '11111111-2222-3333-4444-555555555555';
const vector = JSON.stringify(new Array(EMBEDDING_DIMENSIONS).fill(0.01));

/** A news client that records the filter and returns one stored story. */
function fakeNews() {
  const asked: { or?: string; user?: string } = {};
  const query = {
    select: () => query,
    eq: (_column: string, value: string) => ((asked.user = value), query),
    or: async (filter: string) => {
      asked.or = filter;
      return {
        data: [{ issue_id: ISSUE, story_index: 2, embedding: vector, embedding_model: 'voyage-4-lite' }],
        error: null,
      };
    },
  };
  return { asked, news: { from: () => query } as never };
}

const vault = {
  async rpc() {
    return { data: [{ note_id: 'n1', path: 'Energy.md', title: 'Energy', similarity: 0.62 }], error: null };
  },
} as never;

describe('relatedNotesForStories', () => {
  it('reads only the stories asked for and keys the notes issue:index', async () => {
    const { news, asked } = fakeNews();
    const found = await relatedNotesForStories(news, vault, 'user-1', [
      { issueId: ISSUE, storyIndex: 2 },
      { issueId: 'not-a-uuid),or(true', storyIndex: 1 },
    ]);
    expect(asked.or).toBe(`and(issue_id.eq.${ISSUE},story_index.eq.2)`);
    expect(asked.user).toBe('user-1');
    expect(found.get(`${ISSUE}:2`)).toEqual([
      { noteId: 'n1', title: 'Energy', href: '/vault/n/Energy.md' },
    ]);
  });

  it('asks nothing for a page with no stories', async () => {
    const { news, asked } = fakeNews();
    expect((await relatedNotesForStories(news, vault, 'user-1', [])).size).toBe(0);
    expect(asked.or).toBeUndefined();
  });
});
