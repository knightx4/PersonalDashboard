import { describe, expect, it } from 'vitest';
import { TARGET_COLUMN, TARGET_PATH, isCommentTarget, threadFrom } from '@/lib/comments/load';

describe('threadFrom', () => {
  it('reads a row into the app shape', () => {
    const thread = threadFrom([
      { id: 'c1', author: 'me', body: 'Why two columns here?', created_at: '2026-09-13T09:00:00Z' },
    ]);

    expect(thread).toEqual([
      { id: 'c1', author: 'me', body: 'Why two columns here?', createdAt: '2026-09-13T09:00:00Z' },
    ]);
  });

  it('puts the thread in the order it was written', () => {
    const thread = threadFrom([
      { id: 'c2', author: 'claude', body: 'Second', created_at: '2026-09-13T10:00:00Z' },
      { id: 'c1', author: 'me', body: 'First', created_at: '2026-09-13T09:00:00Z' },
    ]);

    expect(thread.map((comment) => comment.id)).toEqual(['c1', 'c2']);
  });

  // The CLI reads plan rows over a direct connection and asks for no thread.
  it('is empty when nothing was selected', () => {
    expect(threadFrom(undefined)).toEqual([]);
    expect(threadFrom(null)).toEqual([]);
  });

  // An author the check constraint has since stopped naming reads back as
  // yours: a session's reply shown as your own note is the worse mistake.
  it('reads an unknown author as you', () => {
    const [comment] = threadFrom([
      { id: 'c1', author: 'somebody', body: 'Hello', created_at: '2026-09-13T09:00:00Z' },
    ]);

    expect(comment.author).toBe('me');
  });
});

describe('targets', () => {
  it('names the four rows a comment can be about', () => {
    expect(isCommentTarget('idea')).toBe(true);
    expect(isCommentTarget('step')).toBe(true);
    expect(isCommentTarget('raise')).toBe(true);
    expect(isCommentTarget('note')).toBe(true);
    expect(isCommentTarget('order')).toBe(false);
  });

  it('writes each target to its own column', () => {
    expect(TARGET_COLUMN.step).toBe('plan_item_id');
    expect(TARGET_COLUMN.note).toBe('feedback_item_id');
    expect(new Set(Object.values(TARGET_COLUMN)).size).toBe(4);
  });

  it('redraws the page each target is read on', () => {
    expect(TARGET_PATH.note).toBe('/dev/bugs');
  });
});
