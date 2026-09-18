import { describe, expect, it } from 'vitest';
import { FEEDBACK_COLUMNS, feedbackRowFrom } from '@/lib/feedback/load';

/** A row as PostgREST hands it back, before the app shape. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'f1',
    kind: 'bug',
    body: 'The shelf photo picker opens empty',
    page_path: '/shopping/inventory',
    status: 'open',
    priority: 2,
    resolution_note: null,
    commit_sha: null,
    created_at: '2026-09-13T09:00:00Z',
    completed_at: null,
    ...over,
  };
}

describe('feedbackRowFrom', () => {
  it('reads the thread under a note, oldest first', () => {
    const note = feedbackRowFrom(
      row({
        thread: [
          { id: 'c2', author: 'claude', body: 'Second', created_at: '2026-09-13T11:00:00Z' },
          { id: 'c1', author: 'me', body: 'First', created_at: '2026-09-13T10:00:00Z' },
        ],
      }),
    );

    expect(note.thread.map((comment) => comment.id)).toEqual(['c1', 'c2']);
    expect(note.thread[0].author).toBe('me');
  });

  // The changelog and the digest read notes through the same function, and a
  // note nobody has written under is the normal case.
  it('gives a note with nothing under it an empty thread', () => {
    expect(feedbackRowFrom(row()).thread).toEqual([]);
    expect(feedbackRowFrom(row({ thread: [] })).thread).toEqual([]);
  });
});

describe('FEEDBACK_COLUMNS', () => {
  it('asks for the thread as well as the note', () => {
    expect(FEEDBACK_COLUMNS).toContain('thread:dev_comments(');
    expect(FEEDBACK_COLUMNS).toContain('resolution_note');
  });
});
